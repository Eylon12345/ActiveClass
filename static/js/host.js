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
        this.isHebrewActive = false;
        this.translationCache = new Map(); // Cache for translations

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
        this.showFeedbackBtn = document.getElementById('showFeedback');
        this.languageToggle = document.getElementById('languageToggle');

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
        this.showFeedbackBtn.addEventListener('click', () => this.showFeedbackEarly());

        // Add language toggle event
        if (this.languageToggle) {
            this.languageToggle.addEventListener('change', async () => {
                this.isHebrewActive = this.languageToggle.checked;
                await this.updateUILanguage();
            });
        }
    }

    // Translation utility function
    async translateText(text) {
        if (!this.isHebrewActive) return text;

        // Check cache first
        if (this.translationCache.has(text)) {
            return this.translationCache.get(text);
        }

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    target_language: 'hebrew'
                }),
            });

            const data = await response.json();
            if (data.success) {
                // Store in cache
                this.translationCache.set(text, data.translated);
                return data.translated;
            }
            return text;
        } catch (error) {
            console.error('Translation error:', error);
            return text;
        }
    }

    // Update all UI elements based on selected language
    async updateUILanguage() {
        // Update static UI elements based on language
        if (this.isHebrewActive) {
            // Apply RTL direction for Hebrew
            document.body.classList.add('hebrew-active');
            document.querySelectorAll('.card-body, .card-title, p, h1, h2, h3, h4, h5, h6, .answer-option')
                .forEach(el => el.classList.add('hebrew-active'));

            // Translate static UI elements to Hebrew
            document.querySelector('title').textContent = await this.translateText('Host Game - YouTube Quiz');
            this.createGameBtn.textContent = await this.translateText('Create Game');
            this.startGameBtn.textContent = await this.translateText('Start Game');
            this.continueVideo.textContent = await this.translateText('Continue Video');
            this.newGameBtn.textContent = await this.translateText('Start New Game');
            this.showFeedbackBtn.textContent = await this.translateText('Show Feedback');

            // More elements to translate
            const labels = document.querySelectorAll('label');
            for (const label of labels) {
                label.textContent = await this.translateText(label.textContent);
            }

            const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
            for (const heading of headings) {
                if (!heading.id) { // Don't translate dynamic content with IDs
                    heading.textContent = await this.translateText(heading.textContent);
                }
            }
        } else {
            // Remove RTL direction when switching back to English
            document.body.classList.remove('hebrew-active');
            document.querySelectorAll('.hebrew-active').forEach(el => el.classList.remove('hebrew-active'));

            // Reload page to restore English text
            if (this.translationCache.size > 0) {
                window.location.reload();
            }
        }

        // If we have an active question, update that too
        if (this.currentQuestion && this.isQuestionActive) {
            this.translateCurrentQuestion();
        }
    }

    // Translate the current active question
    async translateCurrentQuestion() {
        if (!this.currentQuestion || !this.isQuestionActive) return;

        // Translate question text
        const translatedQuestion = await this.translateText(this.currentQuestion.reflective_question);
        this.questionText.textContent = translatedQuestion;

        // Translate answer options
        const answerOptions = this.answerArea.querySelectorAll('.answer-option');

        for (const option of answerOptions) {
            const originalAnswer = option.getAttribute('data-original-text') || option.textContent;
            option.setAttribute('data-original-text', originalAnswer);

            const translatedAnswer = await this.translateText(originalAnswer);
            option.textContent = translatedAnswer;
        }

        // Translate explanation if visible
        if (!this.explanationArea.classList.contains('hidden')) {
            const originalExplanation = this.explanationArea.getAttribute('data-original-text') || this.explanationArea.textContent;
            this.explanationArea.setAttribute('data-original-text', originalExplanation);

            const translatedExplanation = await this.translateText(originalExplanation);
            this.explanationArea.textContent = translatedExplanation;
        }
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

        this.socket.on('show_feedback', (data) => {
            if (data.answers && data.answers.length > 0) {
                this.checkAllAnswers();
            }
        });
    }

    async createGame() {
        const url = this.videoUrl.value.trim();
        if (!url) {
            alert(await this.translateText('Please enter a YouTube video URL'));
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
                alert(await this.translateText(data.error || 'Error creating game'));
            }
        } catch (error) {
            console.error('Error creating game:', error);
            alert(await this.translateText('Error creating game. Please try again.'));
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

            // Ensure we use the proper QRCode library method
            if (typeof QRCode === 'function') {
                new QRCode(qrCodeElement, {
                    text: joinUrl,
                    width: 128,
                    height: 128,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });
            } else {
                console.error('QRCode library not properly loaded');
                qrCodeElement.innerHTML = `<p>Join URL: <a href="${joinUrl}">${joinUrl}</a></p>`;
            }
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

    async updatePlayerList() {
        this.playerList.innerHTML = '';
        for (const [id, player] of this.players) {
            const playerElement = document.createElement('div');
            playerElement.className = 'player-item';
            playerElement.textContent = `${player.nickname} (${await this.translateText('Score')}: ${player.score})`;
            this.playerList.appendChild(playerElement);
        }
    }

    async startGame() {
        if (this.players.size === 0) {
            alert(await this.translateText('Wait for players to join before starting the game'));
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

    async showQuestion(questionData) {
        this.isQuestionActive = true;
        this.currentQuestion = questionData;
        this.questionContainer.classList.remove('hidden');

        // Store original text and use translated version if Hebrew is active
        const originalQuestion = questionData.reflective_question;
        this.questionText.setAttribute('data-original-text', originalQuestion);
        this.questionText.textContent = this.isHebrewActive ?
            await this.translateText(originalQuestion) : originalQuestion;

        this.answerArea.innerHTML = '';
        this.answersReceived = 0;
        this.answersCount.textContent = '0';
        this.playerAnswers.clear();

        const answers = [
            questionData.correct_answer,
            ...questionData.incorrect_answers
        ].sort(() => Math.random() - 0.5);

        for (const answer of answers) {
            const option = document.createElement('div');
            option.className = 'answer-option';
            option.setAttribute('data-original-text', answer);
            option.textContent = this.isHebrewActive ?
                await this.translateText(answer) : answer;
            this.answerArea.appendChild(option);
        }

        this.showFeedbackBtn.classList.remove('hidden');
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

    async displayAnswerResults(results) {
        this.playerAnswersDisplay.innerHTML = '';
        this.showFeedbackBtn.classList.add('hidden');

        const answerOptions = this.answerArea.querySelectorAll('.answer-option');
        answerOptions.forEach(option => {
            const originalText = option.getAttribute('data-original-text');
            if (originalText === this.currentQuestion.correct_answer) {
                option.classList.add('correct');
            }
        });

        for (const result of results) {
            const player = this.players.get(result.player_id);
            if (result.is_correct) {
                player.score += 100;
                this.players.set(result.player_id, player);
            }

            // Store original explanation for translation
            const originalExplanation = result.explanation;
            const translatedExplanation = this.isHebrewActive ?
                await this.translateText(originalExplanation) : originalExplanation;

            const correctText = this.isHebrewActive ?
                await this.translateText('Correct') : 'Correct';
            const incorrectText = this.isHebrewActive ?
                await this.translateText('Incorrect') : 'Incorrect';

            const answerElement = document.createElement('div');
            answerElement.className = `list-group-item ${result.is_correct ? 'correct' : 'incorrect'}`;
            answerElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${player.nickname}</strong>
                        <div>${result.answer}</div>
                    </div>
                    <span class="badge ${result.is_correct ? 'bg-success' : 'bg-danger'}">
                        ${result.is_correct ? correctText : incorrectText}
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
        }

        if (results.length > 0) {
            this.explanationArea.setAttribute('data-original-text', results[0].explanation);
            this.explanationArea.textContent = this.isHebrewActive ?
                await this.translateText(results[0].explanation) : results[0].explanation;
            this.explanationArea.classList.remove('hidden');
        }

        this.updateScoreDisplay();
        this.continueVideo.classList.remove('hidden');
    }

    showFeedbackEarly() {
        if (this.isQuestionActive && this.gameCode) {
            console.log('Requesting early feedback');
            this.socket.emit('show_feedback', { game_code: this.gameCode });
            this.showFeedbackBtn.classList.add('hidden');
        }
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