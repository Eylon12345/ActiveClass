class HostGame {
    constructor() {
        this.socket = io();
        this.player = null;
        this.gameCode = null;
        this.videoId = null;
        this.players = new Map();
        this.currentQuestion = null;
        this.answersReceived = 0;
        this.playerAnswers = new Map();
        this.isQuestionActive = false;
        this.checkInterval = null;
        this.lastQuestionTime = 0;
        this.nextQuestionData = null;
        this.isYouTubeAPIReady = false;

        // DOM Elements
        this.setupPhase = document.getElementById('setupPhase');
        this.lobbyPhase = document.getElementById('lobbyPhase');
        this.gamePhase = document.getElementById('gamePhase');
        this.resultsPhase = document.getElementById('resultsPhase');
        this.gameInfo = document.getElementById('gameInfo');
        this.gameCodeDisplay = document.getElementById('gameCode');
        this.playerCountDisplay = document.getElementById('playerCount');
        this.playerList = document.getElementById('playerList');
        this.playerScores = document.getElementById('playerScores');
        this.videoUrl = document.getElementById('videoUrl');
        this.gradeLevel = document.getElementById('gradeLevel');
        this.createGameBtn = document.getElementById('createGame');
        this.startGameBtn = document.getElementById('startGame');
        this.questionContainer = document.getElementById('questionContainer');
        this.questionText = document.getElementById('questionText');
        this.answerArea = document.getElementById('answerArea');
        this.answersCount = document.getElementById('answersCount');
        this.totalPlayers = document.getElementById('totalPlayers');
        this.continueVideo = document.getElementById('continueVideo');
        this.finalScores = document.getElementById('finalScores');
        this.newGameBtn = document.getElementById('newGame');
        this.explanationArea = document.getElementById('explanationArea');
        this.playerAnswersDisplay = document.getElementById('playerAnswers');

        this.setupEventListeners();
        this.setupSocketListeners();
        this.initYouTubeAPI();
    }

    initYouTubeAPI() {
        window.onYouTubeIframeAPIReady = () => {
            this.isYouTubeAPIReady = true;
            console.log('YouTube API Ready');
        };
    }

    setupEventListeners() {
        this.createGameBtn.addEventListener('click', () => this.createGame());
        this.startGameBtn.addEventListener('click', () => this.startGame());
        this.continueVideo.addEventListener('click', () => this.resumeVideo());
        this.newGameBtn.addEventListener('click', () => window.location.reload());
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('player_joined', (data) => {
            this.addPlayer(data.player_id, data.nickname);
        });

        this.socket.on('answer_submitted', (data) => {
            this.handlePlayerAnswer(data.player_id, data.nickname, data.answer);
        });
    }

    async createGame() {
        const url = this.videoUrl.value.trim();
        if (!url) {
            alert('Please enter a YouTube video URL');
            return;
        }

        try {
            const response = await fetch('/api/create_game', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            });

            const data = await response.json();
            if (data.success) {
                this.gameCode = data.game_code;
                this.videoId = data.video_id;
                this.showLobby();
            } else {
                alert(data.error || 'Error creating game');
            }
        } catch (error) {
            console.error('Error creating game:', error);
            alert('Error creating game. Please try again.');
        }
    }

    showLobby() {
        this.setupPhase.classList.add('hidden');
        this.lobbyPhase.classList.remove('hidden');
        this.gameInfo.classList.remove('hidden');
        this.gameCodeDisplay.textContent = this.gameCode;

        try {
            const joinUrl = `${window.location.origin}/join?code=${this.gameCode}`;
            const qrCodeElement = document.getElementById('qrCode');
            qrCodeElement.innerHTML = '';
            new QRCode(qrCodeElement, {
                text: joinUrl,
                width: 128,
                height: 128,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch (error) {
            console.error('Error generating QR code:', error);
            document.getElementById('qrCode').innerHTML =
                `<p>Join URL: <a href="/join?code=${this.gameCode}">/join?code=${this.gameCode}</a></p>`;
        }

        this.socket.emit('join_game_room', { game_code: this.gameCode });
    }

    addPlayer(playerId, nickname) {
        this.players.set(playerId, { nickname, score: 0 });
        this.updatePlayerList();
        this.updateScoreDisplay();
        this.playerCountDisplay.textContent = this.players.size;
        this.totalPlayers.textContent = this.players.size;
    }

    updateScoreDisplay() {
        const scoresList = Array.from(this.players.entries())
            .sort((a, b) => b[1].score - a[1].score)
            .map(([id, player]) => `${player.nickname}: ${player.score}`);

        this.playerScores.innerHTML = scoresList
            .map(score => `<div class="badge bg-secondary me-2">${score}</div>`)
            .join('');
    }

    updatePlayerList() {
        this.playerList.innerHTML = '';
        for (const [id, player] of this.players) {
            const playerElement = document.createElement('div');
            playerElement.className = 'player-item';
            playerElement.textContent = `${player.nickname} (Score: ${player.score})`;
            this.playerList.appendChild(playerElement);
        }
    }

    startGame() {
        if (this.players.size === 0) {
            alert('Wait for players to join before starting the game');
            return;
        }

        this.socket.emit('start_game', { game_code: this.gameCode });
        this.showGamePhase();
    }

    showGamePhase() {
        this.lobbyPhase.classList.add('hidden');
        this.gamePhase.classList.remove('hidden');
        this.initYouTubePlayer();
    }

    initYouTubePlayer() {
        this.player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            videoId: this.videoId,
            playerVars: {
                'playsinline': 1,
                'enablejsapi': 1,
                'controls': 1
            },
            events: {
                'onStateChange': (event) => this.onPlayerStateChange(event)
            }
        });
    }

    onPlayerStateChange(event) {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        if (event.data === YT.PlayerState.PLAYING && !this.isQuestionActive) {
            this.checkInterval = setInterval(() => this.handleTimeUpdate(), 1000);
        }
    }

    async handleTimeUpdate() {
        if (this.isQuestionActive) {
            return;
        }

        const currentTime = Math.floor(this.player.getCurrentTime());

        if (currentTime > this.lastQuestionTime + 55 && !this.nextQuestionData) {
            this.nextQuestionData = await this.fetchQuestion(currentTime + 5);
        }

        if (currentTime > this.lastQuestionTime + 60 && this.nextQuestionData) {
            console.log('Showing question at time:', currentTime);
            this.showQuestion(this.nextQuestionData);
            this.player.pauseVideo();
            this.lastQuestionTime = currentTime;
            this.nextQuestionData = null;
        }
    }

    async fetchQuestion(currentTime) {
        try {
            const response = await fetch('/api/generate_question', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    video_id: this.videoId,
                    current_time: currentTime,
                    question_type: 'closed',
                    difficulty: this.gradeLevel.value
                }),
            });

            const data = await response.json();
            if (data.success) {
                return data;
            }
        } catch (error) {
            console.error('Error generating question:', error);
            return null;
        }
    }

    showQuestion(questionData) {
        this.isQuestionActive = true;
        this.currentQuestion = questionData;
        this.questionContainer.classList.remove('hidden');
        this.questionText.textContent = questionData.reflective_question;
        this.answerArea.innerHTML = '';
        this.answersReceived = 0;
        this.answersCount.textContent = '0';
        this.playerAnswers.clear();

        const answers = [
            questionData.correct_answer,
            ...questionData.incorrect_answers
        ].sort(() => Math.random() - 0.5);

        answers.forEach(answer => {
            const option = document.createElement('div');
            option.className = 'answer-option';
            option.textContent = answer;
            this.answerArea.appendChild(option);
        });

        this.continueVideo.classList.add('hidden');

        this.socket.emit('broadcast_question', {
            game_code: this.gameCode,
            question: {
                text: questionData.reflective_question,
                correct_answer: questionData.correct_answer,
                incorrect_answers: questionData.incorrect_answers,
                content_segment: questionData.content_segment
            }
        });
    }

    handlePlayerAnswer(playerId, nickname, answer) {
        if (!this.isQuestionActive) return;

        this.playerAnswers.set(playerId, answer);
        this.answersReceived++;
        this.answersCount.textContent = this.answersReceived;

        if (this.answersReceived === this.players.size) {
            this.checkAllAnswers();
        }
    }

    async checkAllAnswers() {
        try {
            const response = await fetch('/api/check_answer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content_segment: this.currentQuestion.content_segment,
                    question: this.currentQuestion.reflective_question,
                    answers: Array.from(this.playerAnswers.entries()).map(([pid, ans]) => ({
                        player_id: pid,
                        player_name: this.players.get(pid).nickname,
                        answer: ans
                    }))
                }),
            });

            const data = await response.json();
            if (data.success) {
                this.displayAnswerResults(data.results);
            }
        } catch (error) {
            console.error('Error checking answers:', error);
        }
    }

    displayAnswerResults(results) {
        this.playerAnswersDisplay.innerHTML = '';

        // First highlight the correct answer in the answer options
        const answerOptions = this.answerArea.querySelectorAll('.answer-option');
        answerOptions.forEach(option => {
            if (option.textContent === this.currentQuestion.correct_answer) {
                option.classList.add('correct');
            }
        });

        results.forEach(result => {
            const player = this.players.get(result.player_id);
            if (result.is_correct) {
                player.score += 100;
                this.players.set(result.player_id, player);
            }

            const answerElement = document.createElement('div');
            answerElement.className = `list-group-item ${result.is_correct ? 'correct' : 'incorrect'}`;
            answerElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${player.nickname}</strong>
                        <div>${result.answer}</div>
                    </div>
                    <span class="badge ${result.is_correct ? 'bg-success' : 'bg-danger'}">
                        ${result.is_correct ? 'Correct' : 'Incorrect'}
                    </span>
                </div>
            `;
            this.playerAnswersDisplay.appendChild(answerElement);

            this.socket.emit('answer_result', {
                game_code: this.gameCode,
                player_id: result.player_id,
                is_correct: result.is_correct,
                explanation: result.explanation
            });
        });

        if (results.length > 0) {
            this.explanationArea.textContent = results[0].explanation;
            this.explanationArea.classList.remove('hidden');
        }

        this.updateScoreDisplay();
        this.continueVideo.classList.remove('hidden');
    }

    resumeVideo() {
        this.questionContainer.classList.add('hidden');
        this.continueVideo.classList.add('hidden');
        this.explanationArea.classList.add('hidden');
        this.isQuestionActive = false;
        this.player.playVideo();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HostGame();
});