class PlayerGame {
    constructor() {
        this.socket = io();
        this.gameCode = null;
        this.playerId = null;
        this.nickname = null;
        this.score = 0;
        this.currentQuestion = null;
        this.hasAnswered = false;

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

        // Check for game code in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code')) {
            this.gameCodeInput.value = urlParams.get('code');
        }

        this.setupEventListeners();
        this.setupSocketListeners();
    }

    setupEventListeners() {
        this.joinGameBtn.addEventListener('click', () => this.joinGame());
        this.playAgainBtn.addEventListener('click', () => window.location.reload());

        this.gameCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('game_started', () => {
            this.showGamePhase();
        });

        this.socket.on('new_question', (questionData) => {
            this.hasAnswered = false;
            this.currentQuestion = questionData;
            this.questionText.textContent = questionData.text;
            this.answerArea.innerHTML = '';
            this.feedback.classList.add('hidden');

            const answers = [
                questionData.correct_answer,
                ...questionData.incorrect_answers
            ].sort(() => Math.random() - 0.5);

            answers.forEach(answer => {
                const option = document.createElement('div');
                option.className = 'answer-option';
                option.textContent = answer;
                option.addEventListener('click', () => {
                    if (!this.hasAnswered) {
                        this.submitAnswer(answer);
                    }
                });
                this.answerArea.appendChild(option);
            });
        });

        this.socket.on('answer_result', (data) => {
            if (data.player_id === this.playerId) {
                this.showAnswerResult(data.is_correct);
            }
        });
    }

    async joinGame() {
        const gameCode = this.gameCodeInput.value.trim().toUpperCase();
        const nickname = this.nicknameInput.value.trim();

        if (!gameCode || !nickname) {
            alert('Please enter both game code and nickname');
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
                this.showWaitingPhase();
                this.socket.emit('join_game_room', { game_code: this.gameCode });
            } else {
                alert(data.error || 'Error joining game');
            }
        } catch (error) {
            console.error('Error joining game:', error);
            alert('Error joining game. Please try again.');
        }
    }

    showWaitingPhase() {
        this.joinPhase.classList.add('hidden');
        this.waitingPhase.classList.remove('hidden');
        this.playerNickname.textContent = this.nickname;
        this.currentGameCode.textContent = this.gameCode;
    }

    showGamePhase() {
        this.waitingPhase.classList.add('hidden');
        this.gamePhase.classList.remove('hidden');
    }

    submitAnswer(answer) {
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
            if (option.textContent === answer) {
                option.classList.add('selected');
            }
        });

        this.feedback.textContent = 'Waiting for other players...';
        this.feedback.className = 'feedback';
        this.feedback.classList.remove('hidden');
    }

    showAnswerResult(isCorrect) {
        if (isCorrect) {
            this.score += 100;
            if (this.playerScore) {
                this.playerScore.textContent = this.score;
            }
        }

        const selectedOption = this.answerArea.querySelector('.answer-option.selected');
        if (selectedOption) {
            selectedOption.classList.add(isCorrect ? 'correct' : 'incorrect');
        }

        this.feedback.textContent = isCorrect ? 'Correct!' : 'Incorrect!';
        this.feedback.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
        this.feedback.classList.remove('hidden');
    }

    showResults() {
        this.gamePhase.classList.add('hidden');
        this.resultsPhase.classList.remove('hidden');
        this.finalScore.textContent = this.score;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PlayerGame();
});