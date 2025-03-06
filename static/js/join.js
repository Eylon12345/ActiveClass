class PlayerGame {
    constructor() {
        this.socket = io();
        this.gameCode = null;
        this.playerId = null;
        this.nickname = null;
        this.score = 0;
        this.currentQuestion = null;
        this.hasAnswered = false;
        this.isHebrewActive = false;
        this.translationCache = new Map(); // Cache for translations
        this.isReconnecting = false;
        this.lastFeedbackState = null;

        // DOM Elements
        this.joinPhase = document.getElementById('joinPhase');
        this.waitingPhase = document.getElementById('waitingPhase');
        this.gamePhase = document.getElementById('gamePhase');
        this.resultsPhase = document.getElementById('resultsPhase');
        this.gameCodeInput = document.getElementById('gameCode');
        this.nicknameInput = document.getElementById('nickname');
        this.joinGameBtn = document.getElementById('joinGame');
        this.playerNickname = document.getElementById('playerNickname');
        this.currentGameCode = document.getElementById('currentGameCode');
        this.questionContainer = document.getElementById('questionContainer');
        this.questionText = document.getElementById('questionText');
        this.answerArea = document.getElementById('answerArea');
        this.feedback = document.getElementById('feedback');
        this.finalScore = document.getElementById('finalScore');
        this.playAgainBtn = document.getElementById('playAgain');
        this.playerScore = document.getElementById('playerScore');
        this.languageToggle = document.getElementById('languageToggle');

        // Check for game code in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code')) {
            this.gameCodeInput.value = urlParams.get('code');
        }

        // Load previous state from session storage if available
        this.loadStateFromStorage();

        this.setupEventListeners();
        this.setupSocketListeners();

        // Try to reconnect if we have stored credentials
        if (this.gameCode && this.playerId && this.nickname) {
            console.log('Found stored game session, attempting to reconnect');
            this.isReconnecting = true;
            this.reconnectToGame();
        }
    }

    setupEventListeners() {
        this.joinGameBtn.addEventListener('click', () => this.joinGame());
        this.playAgainBtn.addEventListener('click', () => {
            // Clear session storage before starting a new game
            sessionStorage.removeItem('gameState');
            window.location.reload();
        });

        this.gameCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        // Add language toggle event with immediate visual feedback
        if (this.languageToggle) {
            console.log('Setting up language toggle event listener for join page');

            // Add a prominent style to make the toggle more visible
            this.languageToggle.parentElement.style.border = '2px solid var(--primary)';
            this.languageToggle.parentElement.style.padding = '8px';
            this.languageToggle.parentElement.style.borderRadius = '8px';

            // Set initial state of toggle based on stored preference
            if (this.isHebrewActive) {
                this.languageToggle.checked = true;
                this.updateUILanguage(false); // Don't save state again
            }

            this.languageToggle.addEventListener('change', (e) => {
                console.log('Language toggle changed:', e.target.checked);
                this.isHebrewActive = e.target.checked;
                this.updateUILanguage(true);
            });
        } else {
            console.error('Language toggle element not found on join page');
        }

        // Add window beforeunload event to warn about leaving during active game
        window.addEventListener('beforeunload', (e) => {
            if (this.gameCode && this.playerId && this.phase !== 'lobby' && this.phase !== 'results') {
                // Save current state to session storage
                this.saveStateToStorage();

                // Show confirmation dialog
                e.preventDefault();
                e.returnValue = 'You are in an active game. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
    }

    // Save game state to session storage for potential reconnection
    saveStateToStorage() {
        const gameState = {
            gameCode: this.gameCode,
            playerId: this.playerId,
            nickname: this.nickname,
            score: this.score,
            isHebrewActive: this.isHebrewActive,
            phase: this.phase
        };

        try {
            sessionStorage.setItem('gameState', JSON.stringify(gameState));
            console.log('Game state saved to session storage');
        } catch (e) {
            console.error('Failed to save game state:', e);
        }
    }

    // Load game state from session storage
    loadStateFromStorage() {
        try {
            const storedState = sessionStorage.getItem('gameState');
            if (storedState) {
                const gameState = JSON.parse(storedState);
                this.gameCode = gameState.gameCode;
                this.playerId = gameState.playerId; 
                this.nickname = gameState.nickname;
                this.score = gameState.score || 0;
                this.isHebrewActive = gameState.isHebrewActive || false;
                this.phase = gameState.phase || 'lobby';
                console.log('Game state loaded from session storage');
                return true;
            }
        } catch (e) {
            console.error('Failed to load game state:', e);
        }
        return false;
    }

    // Reconnect to an existing game
    reconnectToGame() {
        console.log(`Attempting to reconnect to game ${this.gameCode} as player ${this.playerId}`);

        // First show waiting phase
        this.joinPhase.classList.add('hidden');
        this.waitingPhase.classList.remove('hidden');
        this.playerNickname.textContent = this.nickname;
        this.currentGameCode.textContent = this.gameCode;

        // Then try to join the room
        this.socket.emit('join_game_room', { 
            game_code: this.gameCode,
            player_id: this.playerId
        });
    }

    // Translation utility function
    async translateText(text) {
        if (!this.isHebrewActive) return text;

        // Check cache first
        if (this.translationCache.has(text)) {
            return this.translationCache.get(text);
        }

        try {
            console.log('Translating text (join):', text.substring(0, 30) + '...');
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
                console.log('Translation successful (join)');
                // Store in cache
                this.translationCache.set(text, data.translated);
                return data.translated;
            }
            console.error('Translation failed (join):', data.error);
            return text;
        } catch (error) {
            console.error('Translation error (join):', error);
            return text;
        }
    }

    // Update all UI elements based on selected language
    async updateUILanguage(saveState = true) {
        console.log('Updating UI language on join page, Hebrew active:', this.isHebrewActive);

        // Save state if requested
        if (saveState) {
            this.saveStateToStorage();
        }

        // Update static UI elements based on language
        if (this.isHebrewActive) {
            // Apply RTL direction for Hebrew
            document.body.classList.add('hebrew-active');
            document.querySelectorAll('.card-body, .card-title, p, h1, h2, h3, h4, h5, h6, .answer-option')
                .forEach(el => el.classList.add('hebrew-active'));

            // Show language indicator
            const indicator = document.createElement('div');
            indicator.className = 'alert alert-info mt-2';
            indicator.textContent = 'מצב עברית פעיל';
            document.querySelector('.form-check').appendChild(indicator);

            // Translate static UI elements to Hebrew
            document.querySelector('title').textContent = await this.translateText('Join Game - YouTube Quiz');
            this.joinGameBtn.textContent = await this.translateText('Join Game');
            this.playAgainBtn.textContent = await this.translateText('Play Again');

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

            // Placeholder text
            this.gameCodeInput.placeholder = await this.translateText(this.gameCodeInput.placeholder);
            this.nicknameInput.placeholder = await this.translateText(this.nicknameInput.placeholder);
        } else {
            // Remove RTL direction when switching back to English
            document.body.classList.remove('hebrew-active');
            document.querySelectorAll('.hebrew-active').forEach(el => el.classList.remove('hebrew-active'));

            // Remove language indicator if exists
            const indicator = document.querySelector('.form-check .alert');
            if (indicator) {
                indicator.remove();
            }

            // Don't reload page, just restore English text if we have translations
            if (this.translationCache.size > 0) {
                // Update main UI elements
                document.querySelector('title').textContent = 'Join Game - YouTube Quiz';
                this.joinGameBtn.textContent = 'Join Game';
                this.playAgainBtn.textContent = 'Play Again';

                // Restore placeholders
                this.gameCodeInput.placeholder = 'Enter 6-digit code';
                this.nicknameInput.placeholder = 'Enter your nickname';
            }
        }

        // If we have an active question, update that too
        if (this.currentQuestion) {
            this.translateCurrentQuestion();
        }
    }

    // Translate the current active question
    async translateCurrentQuestion() {
        if (!this.currentQuestion) return;

        // Translate question text
        const originalQuestion = this.questionText.getAttribute('data-original-text') || this.questionText.textContent;
        this.questionText.setAttribute('data-original-text', originalQuestion);
        this.questionText.textContent = this.isHebrewActive ?
            await this.translateText(originalQuestion) : originalQuestion;

        // Translate answer options
        const answerOptions = this.answerArea.querySelectorAll('.answer-option');

        for (const option of answerOptions) {
            const originalAnswer = option.getAttribute('data-original-text') || option.textContent;
            option.setAttribute('data-original-text', originalAnswer);

            const translatedAnswer = this.isHebrewActive ?
                await this.translateText(originalAnswer) : originalAnswer;
            option.textContent = translatedAnswer;
        }

        // Translate feedback if visible
        if (!this.feedback.classList.contains('hidden')) {
            const originalFeedback = this.feedback.getAttribute('data-original-text') || this.feedback.textContent;
            this.feedback.setAttribute('data-original-text', originalFeedback);

            const translatedFeedback = this.isHebrewActive ?
                await this.translateText(originalFeedback) : originalFeedback;
            this.feedback.textContent = translatedFeedback;
        }
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');

            // If we were reconnecting, rejoin the game room
            if (this.isReconnecting) {
                this.reconnectToGame();
                this.isReconnecting = false;
            }
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.showConnectionError();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.isReconnecting = true;
            this.showDisconnectedMessage();
        });

        this.socket.on('game_started', () => {
            console.log('Game started event received');
            this.showGamePhase();
        });

        this.socket.on('new_question', async (questionData) => {
            console.log('New question received:', questionData);
            this.hasAnswered = false;
            this.currentQuestion = questionData;
            this.phase = 'answering';
            this.saveStateToStorage();

            // Store original text for translation
            const originalText = questionData.text;
            this.questionText.setAttribute('data-original-text', originalText);
            this.questionText.textContent = this.isHebrewActive ?
                await this.translateText(originalText) : originalText;

            this.answerArea.innerHTML = '';
            this.feedback.classList.add('hidden');

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
                option.addEventListener('click', () => {
                    if (!this.hasAnswered) {
                        this.submitAnswer(answer);
                    }
                });
                this.answerArea.appendChild(option);
            }

            // Show the game phase if not already visible
            if (this.waitingPhase.classList.contains('hidden') === false) {
                this.showGamePhase();
            }
        });

        this.socket.on('answer_result', async (data) => {
            console.log('Answer result received:', data);
            if (data.player_id === this.playerId) {
                this.showAnswerResult(data.is_correct);
            }
        });

        // Add new event handler for rejected answers
        this.socket.on('answer_rejected', async (data) => {
            console.log('Answer rejected:', data);
            this.showRejectedAnswer(data.reason);
        });

        // Handle feedback display
        this.socket.on('show_feedback', async (data) => {
            console.log('Show feedback event received:', data);
            // Set the phase to feedback
            this.phase = 'feedback';
            this.saveStateToStorage();

            // If we already answered, we'll get a direct answer_result
            // Otherwise, show "Time's up" message
            if (!this.hasAnswered) {
                const timeUpText = await this.translateText("Time's up!");
                this.feedback.textContent = timeUpText;
                this.feedback.setAttribute('data-original-text', "Time's up!");
                this.feedback.className = 'feedback';
                this.feedback.classList.remove('hidden');

                // Disable all answer options
                const options = this.answerArea.querySelectorAll('.answer-option');
                options.forEach(option => {
                    option.style.pointerEvents = 'none';
                    option.classList.add('disabled');
                });
            }
        });

        // Handle reconnection confirmation
        this.socket.on('player_reconnected', (data) => {
            console.log('Reconnection confirmed for player:', data);
            if (data.player_id === this.playerId) {
                // We're back in the game
                console.log('Successfully reconnected to the game');

                // If we were in the game phase, show it again
                if (this.phase === 'playing' || this.phase === 'answering' || this.phase === 'feedback') {
                    this.showGamePhase();
                }
            }
        });

        // Handle timer updates
        this.socket.on('timer_update', (data) => {
            console.log('Timer update:', data.remaining_time);
            // Could add a timer display here if needed
        });
    }

    showConnectionError() {
        // Create or update connection error message
        let errorMsg = document.getElementById('connectionError');
        if (!errorMsg) {
            errorMsg = document.createElement('div');
            errorMsg.id = 'connectionError';
            errorMsg.className = 'alert alert-danger mt-2';
            errorMsg.textContent = 'Connection error. Attempting to reconnect...';
            document.body.prepend(errorMsg);
        }
    }

    showDisconnectedMessage() {
        // Create or update disconnection message
        let disconnectMsg = document.getElementById('disconnectMessage');
        if (!disconnectMsg) {
            disconnectMsg = document.createElement('div');
            disconnectMsg.id = 'disconnectMessage';
            disconnectMsg.className = 'alert alert-warning mt-2 fixed-top w-100 text-center';
            disconnectMsg.textContent = 'Disconnected from server. Reconnecting...';
            document.body.prepend(disconnectMsg);
        }

        // Auto-hide after reconnection
        this.socket.once('connect', () => {
            if (disconnectMsg) {
                disconnectMsg.remove();
            }
        });
    }

    async joinGame() {
        const gameCode = this.gameCodeInput.value.trim().toUpperCase();
        const nickname = this.nicknameInput.value.trim();

        if (!gameCode || !nickname) {
            alert(await this.translateText('Please enter both game code and nickname'));
            return;
        }

        try {
            const response = await fetch('/api/join_game', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ game_code: gameCode, nickname }),
            });

            const data = await response.json();
            if (data.success) {
                this.gameCode = data.game_code;
                this.playerId = data.player_id;
                this.nickname = nickname;
                this.phase = 'lobby';

                // Save state for potential reconnection
                this.saveStateToStorage();

                this.showWaitingPhase();
                this.socket.emit('join_game_room', { 
                    game_code: this.gameCode,
                    player_id: this.playerId
                });
            } else {
                alert(await this.translateText(data.error || 'Error joining game'));
            }
        } catch (error) {
            console.error('Error joining game:', error);
            alert(await this.translateText('Error joining game. Please try again.'));
        }
    }

    async showWaitingPhase() {
        this.joinPhase.classList.add('hidden');
        this.waitingPhase.classList.remove('hidden');
        this.playerNickname.textContent = this.nickname;
        this.currentGameCode.textContent = this.gameCode;

        // Translate waiting phase text if Hebrew is active
        if (this.isHebrewActive) {
            const waitingTitle = this.waitingPhase.querySelector('h3');
            if (waitingTitle) {
                waitingTitle.textContent = await this.translateText(waitingTitle.textContent);
            }

            const paragraphs = this.waitingPhase.querySelectorAll('p');
            for (const p of paragraphs) {
                // Only translate the static parts, not the dynamic values
                if (p.firstChild && p.firstChild.nodeType === Node.TEXT_NODE) {
                    p.firstChild.textContent = await this.translateText(p.firstChild.textContent);
                }
            }
        }
    }

    showGamePhase() {
        this.waitingPhase.classList.add('hidden');
        this.gamePhase.classList.remove('hidden');
        this.phase = 'playing';
        this.saveStateToStorage();

        // Translate score text if Hebrew is active
        if (this.isHebrewActive) {
            this.updateScoreDisplay();
        }
    }

    async updateScoreDisplay() {
        const scoreLabel = this.gamePhase.querySelector('.alert.alert-info h5');
        if (scoreLabel && scoreLabel.firstChild && scoreLabel.firstChild.nodeType === Node.TEXT_NODE) {
            scoreLabel.firstChild.textContent = await this.translateText('Your Score: ');
        }

        // Update score value
        if (this.playerScore) {
            this.playerScore.textContent = this.score;
        }
    }

    async submitAnswer(answer) {
        if (!this.currentQuestion || this.hasAnswered) return;

        this.hasAnswered = true;
        this.socket.emit('submit_answer', {
            game_code: this.gameCode,
            player_id: this.playerId,
            answer: answer
        });

        const options = this.answerArea.querySelectorAll('.answer-option');
        options.forEach(option => {
            option.style.pointerEvents = 'none';
            const optionText = option.getAttribute('data-original-text');
            if (optionText === answer) {
                option.classList.add('selected');
            }
        });

        const waitingText = await this.translateText('Waiting for other players...');
        this.feedback.textContent = waitingText;
        this.feedback.setAttribute('data-original-text', 'Waiting for other players...');
        this.feedback.className = 'feedback';
        this.feedback.classList.remove('hidden');
    }

    async showAnswerResult(isCorrect) {
        if (isCorrect) {
            this.score += 100;
            if (this.playerScore) {
                this.playerScore.textContent = this.score;
            }

            // Save updated score to session storage
            this.saveStateToStorage();
        }

        const selectedOption = this.answerArea.querySelector('.answer-option.selected');
        if (selectedOption) {
            selectedOption.classList.add(isCorrect ? 'correct' : 'incorrect');
        }

        const correctText = await this.translateText('Correct!');
        const incorrectText = await this.translateText('Incorrect!');

        const resultText = isCorrect ? correctText : incorrectText;
        this.feedback.textContent = resultText;
        this.feedback.setAttribute('data-original-text', isCorrect ? 'Correct!' : 'Incorrect!');
        this.feedback.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
        this.feedback.classList.remove('hidden');
    }

    async showRejectedAnswer(reason) {
        const translatedReason = await this.translateText(reason);
        this.feedback.textContent = translatedReason;
        this.feedback.setAttribute('data-original-text', reason);
        this.feedback.className = 'alert alert-warning';
        this.feedback.classList.remove('hidden');

        // Disable all answer options
        const options = this.answerArea.querySelectorAll('.answer-option');
        options.forEach(option => {
            option.style.pointerEvents = 'none';
            option.classList.add('disabled');
        });
    }

    async showResults() {
        this.gamePhase.classList.add('hidden');
        this.resultsPhase.classList.remove('hidden');
        this.finalScore.textContent = this.score;
        this.phase = 'results';
        this.saveStateToStorage();

        // Translate results phase if Hebrew is active
        if (this.isHebrewActive) {
            const gameOverTitle = this.resultsPhase.querySelector('h3');
            if (gameOverTitle) {
                gameOverTitle.textContent = await this.translateText(gameOverTitle.textContent);
            }

            const scoreText = this.resultsPhase.querySelector('.lead');
            if (scoreText && scoreText.firstChild && scoreText.firstChild.nodeType === Node.TEXT_NODE) {
                scoreText.firstChild.textContent = await this.translateText('Your Score: ');
            }

            if (this.playAgainBtn) {
                this.playAgainBtn.textContent = await this.translateText(this.playAgainBtn.textContent);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing PlayerGame');
    new PlayerGame();
});