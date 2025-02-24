import eventlet
eventlet.monkey_patch()

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from openai import OpenAI
import logging
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
import re
import random
import string
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
from datetime import datetime, timedelta
import os

load_dotenv()
logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET")
CORS(app)

# Configure SocketIO with eventlet
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='eventlet',
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25,
    manage_session=False
)

# Store active games in memory
active_games = {}  # Add feedback_shown flag when creating new game

class ReflectionClosedQuestion(BaseModel):
    question: str
    correct_answer: str
    incorrect_answers: List[str]

class ReflectionClosedPromptResponse(BaseModel):
    reflection_prompt: ReflectionClosedQuestion

class ReflectionSingleQuestion(BaseModel):
    is_correct: bool
    explanation: str

class RefectionSinglePromptResponse(BaseModel):
    reflection_prompt: ReflectionSingleQuestion

def generate_game_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def extract_video_id(url):
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu.be\/)([^&\n?]*)',
        r'youtube.com\/embed\/([^&\n?]*)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def get_transcript_segment(video_id, current_time):
    try:
        # Try multiple transcript retrieval methods
        transcript = None
        error_messages = []

        # Log all attempts for debugging
        logging.info(f"Attempting to get transcript for video {video_id}")

        # Method 1: Try direct transcript
        try:
            logging.info("Attempting direct transcript retrieval")
            transcript = YouTubeTranscriptApi.get_transcript(video_id)
            logging.info("Direct transcript retrieval successful")
        except Exception as e:
            error_messages.append(f"Direct transcript: {str(e)}")
            logging.info(f"Direct transcript failed: {str(e)}")

            # Method 2: Try auto-generated transcripts first
            try:
                logging.info("Attempting auto-generated transcript retrieval")
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                transcript = transcript_list.find_generated_transcript(['en']).fetch()
                logging.info("Auto-generated transcript retrieval successful")
            except Exception as e:
                error_messages.append(f"Auto-generated transcript: {str(e)}")
                logging.info(f"Auto-generated transcript failed: {str(e)}")

                # Method 3: Try manual transcripts with language specification
                try:
                    logging.info("Attempting manual transcript retrieval with language specification")
                    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                    transcript = transcript_list.find_manually_created_transcript(['en']).fetch()
                    logging.info("Manual transcript retrieval successful")
                except Exception as e:
                    error_messages.append(f"Manual transcript: {str(e)}")
                    logging.info(f"Manual transcript failed: {str(e)}")

        if transcript is None:
            logging.error(f"All transcript retrieval methods failed for video {video_id}. Errors: {'; '.join(error_messages)}")
            return None

        relevant_text = []
        end_time = current_time
        start_time = max(0, end_time - 60)

        for entry in transcript:
            if start_time <= entry['start'] <= end_time:
                relevant_text.append(entry['text'])

        result = ' '.join(relevant_text)
        logging.info(f"Successfully retrieved transcript segment for video {video_id} from {start_time}s to {end_time}s")
        return result
    except Exception as e:
        logging.error(f"Unexpected error getting transcript for video {video_id}: {str(e)}")
        return None

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/host")
def host():
    return render_template("host.html")

@app.route("/join")
def join():
    return render_template("join.html")

@app.route("/api/create_game", methods=["POST"])
def create_game():
    try:
        url = request.json["url"]
        video_id = extract_video_id(url)

        if not video_id:
            return jsonify({"success": False, "error": "Invalid YouTube URL"}), 400

        logging.info(f"Creating game for video ID: {video_id}")

        test_transcript = get_transcript_segment(video_id, 10)
        if test_transcript is None:
            return jsonify({
                "success": False,
                "error": "Could not access video subtitles. The video might not have subtitles enabled, or they might be restricted. Try another video or ensure the video has captions available."
            }), 400

        game_code = generate_game_code()
        while game_code in active_games:
            game_code = generate_game_code()

        active_games[game_code] = {
            'video_id': video_id,
            'host_id': None,
            'players': {},
            'current_question': None,
            'phase': 'lobby',
            'feedback_shown': False,  # Add this flag
            'settings': {
                'question_type': 'closed',
                'difficulty': '6'
            }
        }

        logging.info(f"Successfully created game with code: {game_code}")
        return jsonify({
            "success": True,
            "game_code": game_code,
            "video_id": video_id
        })
    except Exception as e:
        logging.error(f"Error creating game: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Could not create game. Error: {str(e)}"
        }), 400

@app.route("/api/join_game", methods=["POST"])
def join_game():
    try:
        game_code = request.json["game_code"]
        nickname = request.json["nickname"]
        
        if game_code not in active_games:
            return jsonify({"success": False, "error": "Invalid game code"}), 400
        
        player_id = str(len(active_games[game_code]['players']) + 1)
        active_games[game_code]['players'][player_id] = {
            'nickname': nickname,
            'score': 0
        }
        
        socketio.emit('player_joined', {
            'nickname': nickname,
            'player_id': player_id
        }, room=game_code)
        
        return jsonify({
            "success": True,
            "player_id": player_id,
            "game_code": game_code
        })
    except Exception as e:
        logging.error(f"Error joining game: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/generate_question", methods=["POST"])
def generate_question():
    try:
        video_id = request.json["video_id"]
        current_time = request.json["current_time"]
        question_type = request.json.get("question_type", "closed")
        grade_level = request.json.get("difficulty", "6")

        content_segment = get_transcript_segment(video_id, current_time)
        if not content_segment:
            return jsonify({"success": False, "error": "Could not get video transcript"}), 400

        if question_type == "closed":
            grade_prompt = f"Create questions suitable for {grade_level}th grade students. " if grade_level != "1" else "Create questions suitable for 1st grade students. "
            completion = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": f"You are an expert in creating multiple-choice questions. {grade_prompt}Generate a question with one correct answer and three plausible but incorrect answers."
                    },
                    {
                        "role": "user",
                        "content": f"Generate a multiple-choice question based on this content: {content_segment}"
                    }
                ],
                functions=[{
                    "name": "generate_reflection_prompt",
                    "parameters": ReflectionClosedPromptResponse.schema()
                }],
                function_call={"name": "generate_reflection_prompt"}
            )

            reflection_prompt = ReflectionClosedPromptResponse.model_validate_json(
                completion.choices[0].message.function_call.arguments
            )

            return jsonify({
                "success": True,
                "reflective_question": reflection_prompt.reflection_prompt.question,
                "correct_answer": reflection_prompt.reflection_prompt.correct_answer,
                "incorrect_answers": reflection_prompt.reflection_prompt.incorrect_answers,
                "content_segment": content_segment
            })

    except Exception as e:
        logging.error(f"Error generating question: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/check_answer", methods=["POST"])
def check_answer():
    try:
        content_segment = request.json.get("content_segment")
        question = request.json.get("question")
        answers = request.json.get("answers", [])

        results = []
        for answer_data in answers:
            completion = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert in validating student answers.",
                    },
                    {
                        "role": "user",
                        "content": f"Context: {content_segment}\nQuestion: {question}\nPlease check if this answer is somewhat correct: {answer_data['answer']}. Be lenient - even close or short answers are fine. If incorrect, please explain why.",
                    },
                ],
                functions=[
                    {
                        "name": "generate_reflection_prompt",
                        "parameters": RefectionSinglePromptResponse.model_json_schema(),
                    }
                ],
                function_call={"name": "generate_reflection_prompt"},
            )

            reflection_prompt = RefectionSinglePromptResponse.model_validate_json(
                completion.choices[0].message.function_call.arguments
            )

            results.append({
                "player_id": answer_data["player_id"],
                "answer": answer_data["answer"],
                "is_correct": reflection_prompt.reflection_prompt.is_correct,
                "explanation": reflection_prompt.reflection_prompt.explanation,
            })

        return jsonify({
            "success": True,
            "results": results
        })
    except Exception as e:
        logging.error(f"Error checking answers: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

# Socket.IO event handlers
def start_answer_timer(game_code):
    """Start a timer for the current question. After 60 seconds, trigger feedback."""
    def timer_callback():
        if game_code in active_games and active_games[game_code]['phase'] == 'answering':
            handle_show_feedback({'game_code': game_code})

    timer = threading.Timer(60.0, timer_callback)
    timer.start()
    active_games[game_code]['current_timer'] = timer
    active_games[game_code]['timer_end'] = datetime.now() + timedelta(seconds=60)

@socketio.on('connect')
def handle_connect():
    logging.info('Client connected')

@socketio.on('disconnect')
def handle_disconnect(sid):
    """Handle client disconnection."""
    logging.info(f'Client disconnected: {sid}')

@socketio.on('join_game_room')
def handle_join_room(data):
    game_code = data['game_code']
    if game_code in active_games:
        join_room(game_code)
        emit('room_joined', {'game_code': game_code})

@socketio.on('start_game')
def handle_start_game(data):
    game_code = data['game_code']
    if game_code in active_games:
        active_games[game_code]['phase'] = 'playing'
        emit('game_started', {}, room=game_code)

@socketio.on('show_feedback')
def handle_show_feedback(data):
    """Handle manual triggering of feedback stage."""
    game_code = data['game_code']
    if game_code in active_games:
        # Cancel timer if it exists
        if 'current_timer' in active_games[game_code]:
            active_games[game_code]['current_timer'].cancel()
            active_games[game_code]['current_timer'] = None

        # Change phase to feedback and set feedback flag
        active_games[game_code]['phase'] = 'feedback'
        active_games[game_code]['feedback_shown'] = True  # Set feedback flag

        # Get all submitted answers
        submitted_answers = active_games[game_code].get('submitted_answers', [])

        # Emit feedback event with current answers
        emit('show_feedback', {
            'answers': submitted_answers
        }, room=game_code)

@socketio.on('submit_answer')
def handle_submit_answer(data):
    game_code = data['game_code']
    player_id = data['player_id']
    answer = data['answer']

    if game_code in active_games and player_id in active_games[game_code]['players']:
        # Check if feedback has been shown
        if active_games[game_code].get('feedback_shown', False):
            emit('answer_rejected', {
                'reason': 'Feedback has already been shown'
            }, room=request.sid)
            return

        # Store the answer
        if 'submitted_answers' not in active_games[game_code]:
            active_games[game_code]['submitted_answers'] = []

        active_games[game_code]['submitted_answers'].append({
            'player_id': player_id,
            'nickname': active_games[game_code]['players'][player_id]['nickname'],
            'answer': answer
        })

        # Emit answer submitted event
        emit('answer_submitted', {
            'player_id': player_id,
            'nickname': active_games[game_code]['players'][player_id]['nickname'],
            'answer': answer
        }, room=game_code)

        # Update remaining time
        if 'timer_end' in active_games[game_code]:
            remaining_time = (active_games[game_code]['timer_end'] - datetime.now()).total_seconds()
            emit('timer_update', {'remaining_time': max(0, remaining_time)}, room=game_code)

@socketio.on('broadcast_question')
def handle_broadcast_question(data):
    game_code = data['game_code']
    question_data = data['question']

    if game_code in active_games:
        # Reset submitted answers and feedback flag
        active_games[game_code]['submitted_answers'] = []
        active_games[game_code]['phase'] = 'answering'
        active_games[game_code]['current_question'] = question_data
        active_games[game_code]['feedback_shown'] = False  # Reset feedback flag

        # Start the timer
        start_answer_timer(game_code)

        # Emit the new question with timer information
        emit('new_question', {
            **question_data,
            'timer_duration': 60
        }, room=game_code)

@socketio.on('answer_result')
def handle_answer_result(data):
    game_code = data['game_code']
    player_id = data['player_id']
    is_correct = data['is_correct']
    
    if game_code in active_games and player_id in active_games[game_code]['players']:
        if is_correct:
            active_games[game_code]['players'][player_id]['score'] += 100
        
        emit('answer_result', {
            'player_id': player_id,
            'is_correct': is_correct
        }, room=game_code)

# Initialize the OpenAI client
# the newest OpenAI model is "gpt-4o" which was released May 13, 2024.
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


if __name__ == "__main__":
    logging.info("Starting server with WebSocket support...")
    port = int(os.getenv("PORT", 5000))

    # Simple eventlet configuration
    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        debug=False,
        use_reloader=False,
        log_output=True
    )