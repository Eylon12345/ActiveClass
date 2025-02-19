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
        this.lastQuestionTime = null;
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
        this.videoUrl = document.getElementById('videoUrl');
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

        // Generate QR code
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
        this.playerCountDisplay.textContent = this.players.size;
        this.totalPlayers.textContent = this.players.size;
    }

    updatePlayerList() {
        this.playerList.innerHTML = '';
        for (const [id, player] of this.players) {
            const playerElement = document.createElement('div');
            playerElement.className = 'player-item';
            playerElement.textContent = player.nickname;
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
                'enablejsapi': 1
            },
            events: {
                'onStateChange': (event) => this.onPlayerStateChange(event)
            }
        });
    }

    onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.PLAYING && !this.isQuestionActive) {
            this.checkInterval = setInterval(() => this.handleTimeUpdate(), 1000);
        } else {
            if (this.checkInterval) {
                clearInterval(this.checkInterval);
                this.checkInterval = null;
            }
        }
    }

    handleTimeUpdate() {
        if (this.isQuestionActive) return;

        const currentTime = this.player.getCurrentTime();
        if (!this.lastQuestionTime) {
            this.lastQuestionTime = currentTime;
            return;
        }

        if (currentTime >= this.lastQuestionTime + 60) {
            this.generateQuestion(currentTime);
        }
    }

    async generateQuestion(currentTime) {
        if (this.isQuestionActive) return;

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
                    difficulty: '6'
                }),
            });

            const data = await response.json();
            if (data.success) {
                this.currentQuestion = data;
                this.showQuestion(data);
                this.player.pauseVideo();
                this.lastQuestionTime = currentTime;
                this.isQuestionActive = true;
                this.answersReceived = 0;
                this.answersCount.textContent = '0';
                this.playerAnswers.clear();

                this.socket.emit('update_question', {
                    game_code: this.gameCode,
                    question: data
                });
            }
        } catch (error) {
            console.error('Error generating question:', error);
        }
    }

    showQuestion(questionData) {
        this.questionContainer.classList.remove('hidden');
        this.questionText.textContent = questionData.reflective_question;
        this.answerArea.innerHTML = '';

        const answers = [
            questionData.correct_answer,
            ...questionData.incorrect_answers
        ];

        answers.forEach(answer => {
            const option = document.createElement('div');
            option.className = 'answer-option';
            option.textContent = answer;
            if (answer === questionData.correct_answer) {
                option.classList.add('correct-answer');
            }
            this.answerArea.appendChild(option);
        });
    }

    handlePlayerAnswer(playerId, nickname, answer) {
        this.playerAnswers.set(playerId, answer);
        this.answersReceived++;
        this.answersCount.textContent = this.answersReceived;

        const isCorrect = answer === this.currentQuestion.correct_answer;
        
        this.socket.emit('answer_result', {
            game_code: this.gameCode,
            player_id: playerId,
            is_correct: isCorrect
        });

        if (this.answersReceived === this.players.size) {
            this.continueVideo.classList.remove('hidden');
        }
    }

    resumeVideo() {
        this.questionContainer.classList.add('hidden');
        this.continueVideo.classList.add('hidden');
        this.isQuestionActive = false;
        this.player.playVideo();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HostGame();
});
