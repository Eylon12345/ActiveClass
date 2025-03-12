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
        this.usedTimestamps = new Set(); // Track used timestamps for questions
        this.questionInterval = 2; // Default: generate questions every 2 minutes
        this.questionType = 3; // Default: balanced question type (1-5 scale)
        this.feedbackAttempts = 0; // Track feedback attempts for retry logic
        this._feedbackTimeout = null; // Timeout for feedback


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

        // New slider elements
        this.questionIntervalSlider = document.getElementById('questionInterval');
        this.questionTypeSlider = document.getElementById('questionType');
        this.intervalDisplay = document.getElementById('intervalDisplay');
        this.typeDisplay = document.getElementById('typeDisplay');

        // Debug QR Code library loading
        console.log('QRCode library loaded:', typeof QRCode !== 'undefined');

        // Debug language toggle
        console.log('Language toggle element found:', !!this.languageToggle);

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

        // Add event listeners for the new sliders
        if (this.questionIntervalSlider) {
            this.questionIntervalSlider.addEventListener('input', () => this.updateIntervalDisplay());
            this.updateIntervalDisplay(); // Initialize display
        }

        if (this.questionTypeSlider) {
            this.questionTypeSlider.addEventListener('input', () => this.updateTypeDisplay());
            this.updateTypeDisplay(); // Initialize display
        }

        // Add language toggle event with immediate visual feedback
        if (this.languageToggle) {
            console.log('Setting up language toggle event listener');

            // Add a prominent style to make the toggle more visible
            this.languageToggle.parentElement.style.border = '2px solid var(--primary)';
            this.languageToggle.parentElement.style.padding = '10px';
            this.languageToggle.parentElement.style.borderRadius = 'var(--radius)';

            this.languageToggle.addEventListener('change', (e) => {
                console.log('Language toggle changed:', e.target.checked);
                this.isHebrewActive = e.target.checked;
                this.updateUILanguage();
            });
        }
    }

    // Update the interval display based on slider value
    updateIntervalDisplay() {
        this.questionInterval = parseInt(this.questionIntervalSlider.value);
        this.intervalDisplay.textContent = `${this.questionInterval} minute${this.questionInterval !== 1 ? 's' : ''}`;
        console.log(`Question interval set to ${this.questionInterval} minutes`);
    }

    // Update the question type display based on slider value
    updateTypeDisplay() {
        this.questionType = parseInt(this.questionTypeSlider.value);
        let typeText;

        // Map the 1-5 scale to descriptive text
        switch(this.questionType) {
            case 1:
                typeText = 'Very Specific';
                break;
            case 2:
                typeText = 'Factual';
                break;
            case 3:
                typeText = 'Balanced';
                break;
            case 4:
                typeText = 'Analytical';
                break;
            case 5:
                typeText = 'Deep Thinking';
                break;
            default:
                typeText = 'Balanced';
        }

        this.typeDisplay.textContent = typeText;
        console.log(`Question type set to ${typeText} (${this.questionType})`);
    }

    // Translation utility function
    async translateText(text) {
        if (!this.isHebrewActive) return text;

        // Check cache first
        if (this.translationCache.has(text)) {
            return this.translationCache.get(text);
        }

        try {
            console.log('Translating text:', text.substring(0, 30) + '...');
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
                console.log('Translation successful');
                // Store in cache
                this.translationCache.set(text, data.translated);
                return data.translated;
            }
            console.error('Translation failed:', data.error);
            return text;
        } catch (error) {
            console.error('Translation error:', error);
            return text;
        }
    }

    // Update all UI elements based on selected language
    async updateUILanguage() {
        console.log('Updating UI language, Hebrew active:', this.isHebrewActive);

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

            // Remove language indicator if exists
            const indicator = document.querySelector('.form-check .alert');
            if (indicator) {
                indicator.remove();
            }

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

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server - attempting to reconnect...');
            // Socket.io will automatically try to reconnect
        });

        this.socket.on('reconnect', () => {
            console.log('Reconnected to server');
            // Rejoin the game room if we were in one
            if (this.gameCode) {
                this.socket.emit('join_game_room', { game_code: this.gameCode });
                console.log('Rejoined game room after reconnection:', this.gameCode);
            }
        });

        this.socket.on('player_joined', (data) => {
            this.addPlayer(data.player_id, data.nickname);
        });

        this.socket.on('answer_submitted', (data) => {
            this.handlePlayerAnswer(data.player_id, data.nickname, data.answer);
        });

        this.socket.on('show_feedback', (data) => {
            console.log('Received show_feedback event:', data);
            if (data.answers && data.answers.length > 0) {
                // Reset the feedback attempts counter
                this.feedbackAttempts = 0;
                this.checkAllAnswers();
            } else {
                console.warn('Received empty answers in show_feedback event');
            }
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            // Show error to user
            alert('A connection error occurred. Please refresh the page.');
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
                body: JSON.stringify({ 
                    url,
                    question_interval: this.questionInterval, // Send question interval
                    question_type: this.questionType, // Send question type
                    grade_level: this.gradeLevel.value
                }),
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

        // Generate QR code with enhanced visibility and error handling
        try {
            const joinUrl = `${window.location.origin}/join?code=${this.gameCode}`;
            const qrCodeElement = document.getElementById('qrCode');

            // Clear QR code container
            if (qrCodeElement) {
                qrCodeElement.innerHTML = '';
                console.log('QR code container cleared');

                // Style for a smaller QR code
                qrCodeElement.style.border = '2px solid #007bff';
                qrCodeElement.style.boxShadow = '0 0 10px rgba(0,0,0,0.2)';
                qrCodeElement.style.maxWidth = '120px';  // Smaller size
                qrCodeElement.style.margin = '0 auto';   // Center it

                console.log('Generating QR code for URL:', joinUrl);

                // Use server-side QR code generation
                fetch('/api/generate_qr', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ data: joinUrl }),
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // Create an image element with the base64 data
                        const img = document.createElement('img');
                        img.src = data.qr_code;
                        img.style.width = '100%';
                        img.style.height = 'auto';
                        qrCodeElement.appendChild(img);

                        // Add direct link below QR code
                        const joinLinkElement = document.createElement('div');
                        joinLinkElement.className = 'mt-2 text-center';
                        joinLinkElement.innerHTML = `<strong>Join URL:</strong><br><a href="${joinUrl}" target="_blank">${joinUrl}</a>`;
                        qrCodeElement.appendChild(joinLinkElement);

                        console.log('Server-side QR code generated successfully');
                    } else {
                        throw new Error(data.error || 'Failed to generate QR code');
                    }
                })
                .catch(error => {
                    console.error('Error generating QR code:', error);
                    qrCodeElement.innerHTML = `
                        <div class="alert alert-danger">Error generating QR code</div>
                        <div>Join URL: <a href="${joinUrl}" target="_blank">${joinUrl}</a></div>
                    `;
                });
            } else {
                console.error('QR code container not found');
            }
        } catch (error) {
            console.error('Error generating QR code:', error);
            const qrCodeElement = document.getElementById('qrCode');
            if (qrCodeElement) {
                qrCodeElement.innerHTML = `
                    <div class="alert alert-danger">Error generating QR code</div>
                    <div>Join URL: <a href="/join?code=${this.gameCode}" target="_blank">/join?code=${this.gameCode}</a></div>
                `;
            }
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

        this.socket.emit('start_game', { 
            game_code: this.gameCode,
            question_interval: this.questionInterval,
            question_type: this.questionType
        });
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
            // Check more frequently (every 250ms) to ensure we catch the exact time point
            this.checkInterval = setInterval(() => this.handleTimeUpdate(), 250);
        }
    }

    async handleTimeUpdate() {
        if (this.isQuestionActive) {
            return;
        }

        // Get current time with higher precision
        const currentTime = this.player.getCurrentTime();

        // Calculate interval boundaries based on the chosen question interval (in minutes)
        const intervalInSeconds = this.questionInterval * 60;

        // Calculate the exact time of the next interval point
        const nextIntervalTime = Math.ceil(currentTime / intervalInSeconds) * intervalInSeconds;

        // Time to the next interval point (in seconds)
        const timeToNextInterval = nextIntervalTime - currentTime;

        // Calculate current interval ID to track used intervals
        const currentIntervalId = Math.floor(currentTime / intervalInSeconds);

        // Log detailed timing information for debugging
        if (currentTime % 5 < 0.25) { // Log every ~5 seconds
            console.log(`Current time: ${currentTime.toFixed(2)}s, Next interval: ${nextIntervalTime}s, Time to next: ${timeToNextInterval.toFixed(2)}s, Current interval ID: ${currentIntervalId}`);
        }

        // For 1-minute intervals, we want to be extra precise
        const prefetchThreshold = this.questionInterval === 1 ? 8 : 10;

        // Pre-fetch the question when approaching the interval point
        if (timeToNextInterval <= prefetchThreshold && timeToNextInterval > 0 && !this.nextQuestionData && !this.usedTimestamps.has(currentIntervalId)) {
            console.log(`Pre-fetching question for interval ${currentIntervalId} at time ${currentTime.toFixed(2)}, ${timeToNextInterval.toFixed(2)}s before interval point`);

            // Use the current interval's content as the source material
            const contentStartTime = Math.max(0, nextIntervalTime - intervalInSeconds);
            const contentEndTime = nextIntervalTime;

            try {
                this.nextQuestionData = await this.fetchQuestion(contentStartTime, contentEndTime);
                console.log(`Question pre-fetched successfully for interval ${currentIntervalId}`);
            } catch (error) {
                console.error(`Failed to pre-fetch question for interval ${currentIntervalId}:`, error);
            }
        }

        // Show question when we hit or pass the interval point (with a small buffer for timing precision)
        const bufferTime = 0.5; // Half-second buffer
        if (timeToNextInterval <= bufferTime && currentTime >= (nextIntervalTime - bufferTime) && this.nextQuestionData && !this.usedTimestamps.has(currentIntervalId)) {
            console.log(`Showing question at interval point ${nextIntervalTime}s (current time: ${currentTime.toFixed(2)}s)`);

            // Mark this interval as used
            this.usedTimestamps.add(currentIntervalId);

            // Show the pre-fetched question
            this.showQuestion(this.nextQuestionData);

            // Pause the video
            this.player.pauseVideo();

            // Record this time and reset question data
            this.lastQuestionTime = currentTime;
            this.nextQuestionData = null;
        }
    }

    async fetchQuestion(startTime, endTime) {
        try {
            console.log(`Fetching question for time range ${startTime.toFixed(2)}-${endTime.toFixed(2)}`);
            const response = await fetch('/api/generate_question', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    video_id: this.videoId,
                    start_time: startTime,
                    end_time: endTime,
                    question_type: this.questionType, // Send the question type (1-5)
                    difficulty: this.gradeLevel.value
                }),
            });

            const data = await response.json();
            if (data.success) {
                console.log(`Generated question for time range ${startTime.toFixed(2)}-${endTime.toFixed(2)}: "${data.reflective_question.substring(0, 50)}..."`);
                return data;
            } else {
                console.error('Failed to generate question:', data.error);
                throw new Error(data.error || 'Failed to generate question');
            }
        } catch (error) {
            console.error('Error generating question:', error);
            throw error;
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

        // Clear previous feedback and explanation
        this.explanationArea.classList.add('hidden');
        this.explanationArea.textContent = '';
        this.playerAnswersDisplay.innerHTML = '';

        // Reset answers received counters
        this.answersReceived = 0;
        this.answersCount.textContent = '0';
        this.totalPlayers.textContent = this.players.size;

        // Reset feedback attempts counter
        this.feedbackAttempts = 0;

        console.log('Broadcasting question to players:', questionData.reflective_question.substring(0, 30) + '...');
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

        console.log(`Received answer from ${nickname} (${playerId}): ${answer.substring(0, 20)}...`);
        this.playerAnswers.set(playerId, answer);
        this.answersReceived++;
        this.answersCount.textContent = this.answersReceived;

        if (this.answersReceived === this.players.size) {
            console.log('All players have answered. Checking answers...');
            this.checkAllAnswers();
        }
    }

    showFeedbackEarly() {
        if (!this.isQuestionActive || !this.gameCode) {
            console.warn('Cannot show feedback - game not active or no game code');
            return;
        }

        console.log('Requesting feedback with state:', {
            isQuestionActive: this.isQuestionActive,
            answersReceived: this.answersReceived,
            totalPlayers: this.players.size
        });

        // If there are no answers, show message and enable continue
        if (this.playerAnswers.size === 0) {
            console.log('No answers to show feedback for');
            this.explanationArea.textContent = 'No answers were submitted. You can continue the video.';
            this.explanationArea.classList.remove('hidden');
            this.continueVideo.classList.remove('hidden');
            this.showFeedbackBtn.classList.add('hidden');

            // Remove any existing bypass button
            const existingBypassBtn = document.querySelector('.btn-warning');
            if (existingBypassBtn) {
                existingBypassBtn.remove();
            }
            return;
        }

        // Disable feedback button and show processing state
        this.showFeedbackBtn.disabled = true;
        this.showFeedbackBtn.textContent = 'Processing...';

        // Send show_feedback event to server
        this.socket.emit('show_feedback', { game_code: this.gameCode });

        // Start feedback timeout handler
        this.handleFeedbackTimeout();
    }

    handleFeedbackTimeout() {
        // Clear any existing timeout
        if (this._feedbackTimeout) {
            clearTimeout(this._feedbackTimeout);
        }

        // Set new timeout for feedback
        this._feedbackTimeout = setTimeout(() => {
            if (!this.isQuestionActive) return;

            if (this.continueVideo.classList.contains('hidden')) {
                console.log('Feedback timed out, showing recovery options');

                // Reset feedback button
                this.showFeedbackBtn.disabled = false;
                this.showFeedbackBtn.textContent = 'Try Feedback Again';

                // Add bypass option if it doesn't exist
                if (!document.querySelector('.btn-warning')) {
                    const bypassButton = document.createElement('button');
                    bypassButton.className = 'btn btn-warning mt-2 ms-2';
                    bypassButton.textContent = 'Skip & Continue';
                    bypassButton.onclick = () => {
                        // Clean up UI before resuming
                        this.cleanupFeedbackUI();
                        this.resumeVideo();
                    };
                    this.showFeedbackBtn.parentNode.appendChild(bypassButton);
                }

                // Show explanation
                this.explanationArea.textContent = 'The feedback system is taking longer than expected. You can try again or skip and continue.';
                this.explanationArea.classList.remove('hidden');
            }
        }, 5000); // 5 second timeout
    }

    cleanupFeedbackUI() {
        // Clear any pending timeouts
        if (this._feedbackTimeout) {
            clearTimeout(this._feedbackTimeout);
            this._feedbackTimeout = null;
        }

        // Remove any bypass buttons
        const bypassBtn = document.querySelector('.btn-warning');
        if (bypassBtn) {
            bypassBtn.remove();
        }

        // Reset feedback button state
        this.showFeedbackBtn.disabled = false;
        this.showFeedbackBtn.textContent = 'Show Feedback';
        this.showFeedbackBtn.classList.remove('hidden');

        // Clear error messages
        if (this.explanationArea.textContent.includes('taking longer than expected')) {
            this.explanationArea.textContent = '';
            this.explanationArea.classList.add('hidden');
        }
    }

    resumeVideo() {
        // Clear any pending feedback timeout
        if (this._feedbackTimeout) {
            clearTimeout(this._feedbackTimeout);
            this._feedbackTimeout = null;
        }

        // Clean up timer
        const timerDisplay = document.getElementById('questionTimer');
        if (timerDisplay) {
            timerDisplay.remove();
        }

        // Clean up UI elements
        this.cleanupFeedbackUI();

        // Reset game state
        this.isQuestionActive = false;
        this.answersReceived = 0;
        this.playerAnswers.clear();

        // Clear UI elements
        this.questionContainer.classList.add('hidden');
        this.continueVideo.classList.add('hidden');
        this.explanationArea.classList.add('hidden');
        this.explanationArea.textContent = '';
        this.questionText.textContent = '';
        this.answerArea.innerHTML = '';
        this.playerAnswersDisplay.innerHTML = '';

        // Notify server about feedback clearance
        console.log('Emitting clear_feedback event');
        this.socket.emit('clear_feedback', { game_code: this.gameCode });

        // Resume playback
        this.player.playVideo();
    }

    async checkAllAnswers() {
        if (this.playerAnswers.size === 0) {
            console.warn('No player answers to check');
            this.continueVideo.classList.remove('hidden');
            this.showFeedbackBtn.classList.add('hidden');
            return;
        }

        try {
            console.log('Checking answers...');

            // Create a structured request with all player answers
            const requestData = {
                content_segment: this.currentQuestion.content_segment,
                question: this.currentQuestion.reflective_question,
                answers: Array.from(this.playerAnswers.entries()).map(([pid, ans]) => ({
                    player_id: pid,
                    player_name: this.players.get(pid)?.nickname || 'Unknown Player',
                    answer: ans
                }))
            };

            console.log(`Sending ${requestData.answers.length} answers for checking`);

            const response = await fetch('/api/check_answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            if (data.success) {
                console.log(`Answer check successful: ${data.results.length} results received`);
                this.displayAnswerResults(data.results);
            } else {
                throw new Error(data.error || 'Unknown error checking answers');
            }
        } catch (error) {
            console.error('Error checking answers:', error);

            // Show error message and fallback UI
            this.explanationArea.textContent = `Error checking answers: ${error.message}. Please try again or continue.`;
            this.explanationArea.classList.remove('hidden');

            // Show continue button even if checking failed
            this.continueVideo.classList.remove('hidden');
            this.showFeedbackBtn.classList.add('hidden');
        }
    }

    async displayAnswerResults(results) {
        // Clear the player answers display and update UI state
        this.playerAnswersDisplay.innerHTML = '';
        this.showFeedbackBtn.classList.add('hidden');
        this.showFeedbackBtn.disabled = false;

        console.log(`Displaying results for ${results.length} answers`);

        // Highlight the correct answer
        const answerOptions = this.answerArea.querySelectorAll('.answer-option');
        answerOptions.forEach(option => {
            const originalText = option.getAttribute('data-original-text');
            if (originalText === this.currentQuestion.correct_answer) {
                option.classList.add('correct');
            }
        });

        // Process each player result
        for (const result of results) {
            // Update player score if correct
            const player = this.players.get(result.player_id);
            if (player && result.is_correct) {
                player.score += 100;
                this.players.set(result.player_id, player);
            }

            // Prepare translated text
            const originalExplanation = result.explanation;
            const translatedExplanation = this.isHebrewActive ?
                await this.translateText(originalExplanation) : originalExplanation;

            const correctText = this.isHebrewActive ?
                await this.translateText('Correct') : 'Correct';
            const incorrectText = this.isHebrewActive ?
                await this.translateText('Incorrect') : 'Incorrect';

            // Create and append the answer element
            const answerElement = document.createElement('div');
            answerElement.className = `list-group-item ${result.is_correct ? 'correct' : 'incorrect'}`;
            answerElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${player?.nickname || 'Unknown Player'}</strong>
                        <div>${result.answer}</div>
                    </div>
                    <span class="badge ${result.is_correct ? 'bg-success' : 'bg-danger'}">
                        ${result.is_correct ? correctText : incorrectText}
                    </span>
                </div>
            `;
            this.playerAnswersDisplay.appendChild(answerElement);

            // Emit result to the player
            this.socket.emit('answer_result', {
                game_code: this.gameCode,
                player_id: result.player_id,
                is_correct: result.is_correct,
                explanation: result.explanation
            });
        }

        // Display explanation if available
        if (results.length > 0) {
            this.explanationArea.setAttribute('data-original-text', results[0].explanation);
            this.explanationArea.textContent = this.isHebrewActive ?
                await this.translateText(results[0].explanation) : results[0].explanation;
            this.explanationArea.classList.remove('hidden');
        }

        // Update scores and show continue button
        this.updateScoreDisplay();
        this.continueVideo.classList.remove('hidden');

        console.log('Answer results displayed successfully');
    }

    resumeVideo() {
        // Clear any pending feedback timeout
        if (this._feedbackTimeout) {
            clearTimeout(this._feedbackTimeout);
            this._feedbackTimeout = null;
        }

        // Clean up timer
        const timerDisplay = document.getElementById('questionTimer');
        if (timerDisplay) {
            timerDisplay.remove();
        }

        // Clean up UI elements
        this.cleanupFeedbackUI();

        // Reset game state
        this.isQuestionActive = false;
        this.answersReceived = 0;
        this.playerAnswers.clear();

        // Clear UI elements
        this.questionContainer.classList.add('hidden');
        this.continueVideo.classList.add('hidden');
        this.explanationArea.classList.add('hidden');
        this.explanationArea.textContent = '';
        this.questionText.textContent = '';
        this.answerArea.innerHTML = '';
        this.playerAnswersDisplay.innerHTML = '';

        // Notify server about feedback clearance
        console.log('Emitting clear_feedback event');
        this.socket.emit('clear_feedback', { game_code: this.gameCode });

        // Resume playback
        this.player.playVideo();
    }
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing HostGame');
    new HostGame();
});