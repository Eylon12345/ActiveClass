import eventlet
eventlet.monkey_patch()

import os
import requests

from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
from openai import OpenAI
import logging
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv
import re
import random
import string
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
from datetime import datetime, timedelta
import qrcode
from io import BytesIO
import base64

load_dotenv()
logging.basicConfig(level=logging.DEBUG)

# Initialize OpenAI client
openai_api_key = os.environ.get("OPENAI_API_KEY")
if not openai_api_key:
    logging.warning("OPENAI_API_KEY not found in environment variables")
client = OpenAI(api_key=openai_api_key)

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

def get_transcript_segment(video_id, start_time, end_time):
    try:
        # Log the attempt
        logging.info(f"Attempting to get transcript for video {video_id} from {start_time}s to {end_time}s")

        # Try Supadata API as the primary method
        transcript = None
        try:
            logging.info("Attempting Supadata API transcript retrieval")
            supadata_api_key = os.environ.get("SUPADATA_API_KEY")

            if not supadata_api_key:
                logging.warning("Supadata API key not found in environment variables")
                return None

            # Make request to Supadata API
            supadata_url = "https://api.supadata.ai/v1/youtube/transcript"
            headers = {
                "X-API-Key": supadata_api_key,
                "Content-Type": "application/json"
            }
            params = {
                "videoId": video_id
            }

            response = requests.get(supadata_url, headers=headers, params=params)

            if response.status_code == 200:
                # Parse Supadata response
                supadata_data = response.json()
                logging.info(f"Supadata API response keys: {supadata_data.keys()}")

                # Check if the response has the 'content' field as shown in the error message
                if "content" in supadata_data:
                    transcript = []
                    for item in supadata_data["content"]:
                        transcript.append({
                            "text": item.get("text", ""),
                            "start": item.get("offset", 0) / 1000,  # Convert milliseconds to seconds
                            "duration": item.get("duration", 0) / 1000  # Convert milliseconds to seconds
                        })
                    logging.info("Supadata API transcript retrieval successful")
                else:
                    logging.warning(f"Unexpected Supadata API response format: {supadata_data}")
                    return None
            else:
                logging.warning(f"Supadata API error: {response.status_code}, {response.text}")
                return None
        except Exception as e:
            logging.error(f"Supadata API failed: {str(e)}")
            return None

        if transcript is None:
            logging.error(f"Could not retrieve transcript for video {video_id}")
            return None

        relevant_text = []

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

# New route for generating QR codes on the server side
@app.route("/api/generate_qr", methods=["POST"])
def generate_qr():
    try:
        data = request.json.get("data", "")
        if not data:
            return jsonify({"success": False, "error": "No data provided for QR code"}), 400

        logging.info(f"Generating QR code for: {data}")

        # Create QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=10,
            border=4,
        )
        qr.add_data(data)
        qr.make(fit=True)

        # Create an image from the QR Code
        img = qr.make_image(fill_color="black", back_color="white")

        # Convert image to bytes
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()

        return jsonify({
            "success": True,
            "qr_code": f"data:image/png;base64,{img_str}"
        })
    except Exception as e:
        logging.error(f"Error generating QR code: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/create_game", methods=["POST"])
def create_game():
    try:
        url = request.json["url"]
        # Get the new parameters with defaults if not provided
        question_interval = request.json.get("question_interval", 2)  # Default: 2 minutes
        question_type = request.json.get("question_type", 3)  # Default: 3 (balanced)
        grade_level = request.json.get("grade_level", "6")  # Default: 6th grade

        video_id = extract_video_id(url)

        if not video_id:
            return jsonify({"success": False, "error": "Invalid YouTube URL"}), 400

        logging.info(f"Creating game for video ID: {video_id}")

        test_transcript = get_transcript_segment(video_id, 10, 70) #testing segment
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
            'player_sockets': {},
            'current_question': None,
            'phase': 'lobby',
            'feedback_shown': False,
            'submitted_answers': [],
            'last_activity': datetime.now(),
            'settings': {
                'question_interval': question_interval,
                'question_type': question_type,
                'difficulty': grade_level
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
            logging.warning(f"Attempt to join non-existent game: {game_code}")
            return jsonify({"success": False, "error": "Invalid game code"}), 400

        # Generate a unique player ID with more resilience
        # Get the highest existing player ID and add 1
        existing_ids = [int(pid) for pid in active_games[game_code]['players'].keys() if pid.isdigit()]
        next_id = 1 if not existing_ids else max(existing_ids) + 1
        player_id = str(next_id)
        
        # Store player in game
        active_games[game_code]['players'][player_id] = {
            'nickname': nickname,
            'score': 0,
            'join_time': datetime.now().isoformat()
        }
        
        # Initialize player_sockets if it doesn't exist
        if 'player_sockets' not in active_games[game_code]:
            active_games[game_code]['player_sockets'] = {}
            
        # Update last activity timestamp
        active_games[game_code]['last_activity'] = datetime.now()

        logging.info(f"Player {player_id} ({nickname}) joined game {game_code}")

        # Notify all clients in the room about the new player
        socketio.emit('player_joined', {
            'nickname': nickname,
            'player_id': player_id
        }, room=game_code, broadcast=True)

        return jsonify({
            "success": True,
            "player_id": player_id,
            "game_code": game_code
        })
    except Exception as e:
        logging.error(f"Error joining game: {str(e)}")
        return jsonify({"success": False, "error": f"Could not join game: {str(e)}"}), 500

@app.route("/api/generate_question", methods=["POST"])
def generate_question():
    try:
        video_id = request.json["video_id"]
        start_time = request.json.get("start_time", 0)
        end_time = request.json.get("end_time", start_time + 60)
        question_type = request.json.get("question_type", 3)  # Default: 3 (balanced)
        grade_level = request.json.get("difficulty", "6")

        content_segment = get_transcript_segment(video_id, start_time, end_time)
        if not content_segment:
            return jsonify({"success": False, "error": "Could not get video transcript"}), 400

        # Create a question type prompt based on the slider value (1-5)
        question_style_prompt = ""
        if question_type == 1:
            question_style_prompt = "Create very specific, factual multiple-choice questions that directly test recall of information presented in the content. Focus on names, dates, and explicit facts mentioned."
        elif question_type == 2:
            question_style_prompt = "Create factual multiple-choice questions that test basic comprehension of the main points in the content."
        elif question_type == 3:
            question_style_prompt = "Create balanced multiple-choice questions that test both recall of facts and understanding of concepts from the content."
        elif question_type == 4:
            question_style_prompt = "Create analytical multiple-choice questions that require deeper understanding and application of concepts from the content."
        else:  # question_type == 5
            question_style_prompt = "Create deep thinking multiple-choice questions that challenge students to evaluate, synthesize or apply the content in new contexts. These should require critical thinking beyond just recalling information."

        grade_prompt = f"Create questions suitable for {grade_level}th grade students. " if grade_level != "1" else "Create questions suitable for 1st grade students. "
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"You are an expert in creating multiple-choice questions. {grade_prompt}{question_style_prompt}"
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

# Add the translation endpoint after line 314 (after the check_answer route)

@app.route("/api/translate", methods=["POST"])
def translate_text():
    try:
        text = request.json.get("text")
        target_language = request.json.get("target_language", "hebrew")

        if not text:
            return jsonify({"success": False, "error": "No text provided"}), 400

        logging.info(f"Translation request received for text: {text[:50]}... to {target_language}")

        # Use OpenAI to translate the text
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"You are a professional translator. Translate the following text to {target_language}. Keep any special formatting and HTML intact. Only translate the actual text content."
                },
                {
                    "role": "user",
                    "content": text
                }
            ]
        )

        translated_text = completion.choices[0].message.content
        logging.info(f"Translation successful. Result: {translated_text[:50]}...")

        return jsonify({
            "success": True,
            "original": text,
            "translated": translated_text
        })
    except Exception as e:
        logging.error(f"Error translating text: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

# Socket.IO event handlers
def start_answer_timer(game_code):
    """Start a timer for the current question. After 60 seconds, trigger feedback."""
    def timer_callback():
        try:
            if game_code in active_games and active_games[game_code]['phase'] == 'answering':
                logging.info(f"Timer expired for game {game_code}. Automatically showing feedback.")
                handle_show_feedback({'game_code': game_code})
            else:
                logging.info(f"Timer expired for game {game_code}, but game is no longer in answering phase.")
        except Exception as e:
            logging.error(f"Error in timer callback for game {game_code}: {str(e)}")

    # Cancel any existing timer first to prevent overlaps
    if game_code in active_games and 'current_timer' in active_games[game_code] and active_games[game_code]['current_timer']:
        try:
            active_games[game_code]['current_timer'].cancel()
            logging.info(f"Cancelled existing timer for game {game_code}")
        except:
            logging.warning(f"Failed to cancel existing timer for game {game_code}")

    # Create and store the new timer
    timer = threading.Timer(60.0, timer_callback)
    timer.daemon = True  # Make timer a daemon thread so it doesn't block program exit
    timer.start()

    # Store timer and end time in game state
    active_games[game_code]['current_timer'] = timer
    active_games[game_code]['timer_end'] = datetime.now() + timedelta(seconds=60)
    active_games[game_code]['answers_timer_started'] = True
    
    logging.info(f"Started 60-second answer timer for game {game_code}")

@socketio.on('connect')
def handle_connect():
    logging.info(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    logging.info(f'Client disconnected: {request.sid}')

    # Try to recover disconnected players
    for game_code, game in active_games.items():
        # Check if this socket is in this game
        for player_id, player_data in game.get('player_sockets', {}).items():
            if player_data.get('socket_id') == request.sid:
                logging.info(f'Player {player_id} disconnected from game {game_code}')
                # Don't remove the player immediately, allow reconnection
                player_data['connected'] = False
                player_data['last_seen'] = datetime.now()
                # Notify other players
                emit('player_disconnected', {
                    'player_id': player_id,
                    'nickname': game['players'][player_id]['nickname']
                }, room=game_code)
                break

@socketio.on('join_game_room')
def handle_join_room(data):
    game_code = data['game_code']
    player_id = data.get('player_id')
    is_host = data.get('is_host', False)

    logging.info(f'Socket {request.sid} attempting to join game room {game_code} - Player ID: {player_id}, Is Host: {is_host}')
    
    if game_code not in active_games:
        logging.warning(f'Attempt to join non-existent game: {game_code}')
        emit('join_error', {'error': 'Game does not exist'})
        return

    # Join the socket to the game's room
    join_room(game_code)
    logging.info(f'Socket {request.sid} joined room {game_code}')

    # Initialize player_sockets dictionary if it doesn't exist
    if 'player_sockets' not in active_games[game_code]:
        active_games[game_code]['player_sockets'] = {}

    # Update last activity timestamp
    active_games[game_code]['last_activity'] = datetime.now()

    # If this is the host
    if is_host:
        logging.info(f'Host connected to game {game_code} with socket {request.sid}')
        active_games[game_code]['host_socket_id'] = request.sid
        
        # Send current game state to the host
        emit('game_state_update', {
            'state': active_games[game_code].get('phase', 'lobby'),
            'players': [{'id': pid, 'nickname': p['nickname'], 'score': p.get('score', 0)} 
                       for pid, p in active_games[game_code]['players'].items()],
            'current_question': active_games[game_code].get('current_question')
        })
    
    # If this is a player (not just a spectator/host)
    elif player_id and player_id in active_games[game_code]['players']:
        player_nickname = active_games[game_code]['players'][player_id]['nickname']
        logging.info(f'Player {player_id} ({player_nickname}) connected with socket {request.sid} in game {game_code}')
        
        # Track this socket for the player
        active_games[game_code]['player_sockets'][player_id] = {
            'socket_id': request.sid,
            'connected': True,
            'last_seen': datetime.now()
        }

        # If this was a reconnection, update status and notify everyone
        emit('player_reconnected', {
            'player_id': player_id,
            'nickname': player_nickname
        }, room=game_code)
        
        # Send current game state to the reconnecting player
        game_state = active_games[game_code].get('phase', 'lobby')
        current_question = active_games[game_code].get('current_question', None)
        
        emit('game_state_update', {
            'state': game_state,
            'question': current_question,
            'scores': {pid: p.get('score', 0) for pid, p in active_games[game_code]['players'].items()}
        })
        
        # If game is in progress, send the current question
        if game_state == 'answering' and current_question:
            emit('new_question', current_question)
        elif game_state == 'feedback' and 'feedback_data' in active_games[game_code]:
            emit('answer_results', active_games[game_code]['feedback_data'])

    # Confirm room join to the client that just connected
    emit('room_joined', {'game_code': game_code})

@socketio.on('start_game')
def handle_start_game(data):
    game_code = data['game_code']
    # Capture the question settings if provided
    question_interval = data.get('question_interval')
    question_type = data.get('question_type')

    if game_code in active_games:
        active_games[game_code]['phase'] = 'playing'

        # Update settings if provided
        if question_interval is not None:
            active_games[game_code]['settings']['question_interval'] = question_interval
        if question_type is not None:
            active_games[game_code]['settings']['question_type'] = question_type

        emit('game_started', {}, room=game_code)

@socketio.on('show_feedback')
def handle_show_feedback(data):
    """Handle manual triggering of feedback stage."""
    try:
        game_code = data['game_code']
        if game_code not in active_games:
            logging.warning(f"Show feedback called for non-existent game: {game_code}")
            return

        # Make sure we don't process feedback twice
        if active_games[game_code].get('feedback_shown', False) and active_games[game_code]['phase'] == 'feedback':
            logging.info(f"Game {game_code}: Feedback already shown, ignoring duplicate request")
            return
            
        logging.info(f"Game {game_code}: Processing feedback request")
        
        # Cancel timer if it exists
        if 'current_timer' in active_games[game_code] and active_games[game_code]['current_timer']:
            try:
                active_games[game_code]['current_timer'].cancel()
                logging.info(f"Game {game_code}: Cancelled answer timer")
            except:
                logging.warning(f"Game {game_code}: Failed to cancel timer")
            active_games[game_code]['current_timer'] = None

        # Change phase to feedback and set feedback flag
        active_games[game_code]['phase'] = 'feedback'
        active_games[game_code]['feedback_shown'] = True
        
        # Prepare the answers - ensure we have a valid list even if none were submitted
        if 'submitted_answers' not in active_games[game_code]:
            active_games[game_code]['submitted_answers'] = []
            
        submitted_answers = active_games[game_code]['submitted_answers']
        
        # Log details for debugging
        player_count = len(active_games[game_code]['players'])
        answer_count = len(submitted_answers)
        logging.info(f"Game {game_code}: Showing feedback for {answer_count}/{player_count} players who submitted answers")
        
        # Create a detailed log of which players submitted answers
        if answer_count > 0:
            player_names = [ans['nickname'] for ans in submitted_answers]
            logging.info(f"Game {game_code}: Answers from: {', '.join(player_names)}")
        
        # Emit feedback event with current answers to all players
        # Using broadcast=True to ensure all connected clients receive it
        emit('show_feedback', {
            'answers': submitted_answers
        }, room=game_code, broadcast=True)
        
        logging.info(f"Game {game_code}: Feedback show event emitted successfully")
    except Exception as e:
        logging.error(f"Error handling show_feedback: {str(e)}")
        # Try to recover if possible by sending a basic response
        try:
            if 'game_code' in data and data['game_code'] in active_games:
                emit('show_feedback', {'answers': []}, room=data['game_code'])
                logging.info(f"Sent recovery feedback response to game {data['game_code']}")
        except:
            logging.error("Failed to send recovery feedback response")

@socketio.on('submit_answer')
def handle_submit_answer(data):
    game_code = data['game_code']
    player_id = data['player_id']
    answer = data['answer']

    logging.info(f"Player {player_id} submitting answer in game {game_code}")

    if game_code in active_games and player_id in active_games[game_code]['players']:
        # Check if feedback has been shown for the current question
        if active_games[game_code].get('feedback_shown', False):
            logging.info(f"Answer rejected - feedback already shown for game {game_code}")
            emit('answer_rejected', {
                'reason': 'Feedback has already been shown'
            }, room=request.sid)
            return

        # Store the answer
        if 'submitted_answers' not in active_games[game_code]:
            active_games[game_code]['submitted_answers'] = []

        # Check if player already submitted an answer
        existing_answer_index = None
        for i, existing_answer in enumerate(active_games[game_code]['submitted_answers']):
            if existing_answer['player_id'] == player_id:
                existing_answer_index = i
                break

        if existing_answer_index is not None:
            # Update existing answer
            active_games[game_code]['submitted_answers'][existing_answer_index]['answer'] = answer
            logging.info(f"Updated answer for player {player_id} in game {game_code}")
        else:
            # Add new answer
            active_games[game_code]['submitted_answers'].append({
                'player_id': player_id,
                'nickname': active_games[game_code]['players'][player_id]['nickname'],
                'answer': answer
            })
            logging.info(f"Added new answer for player {player_id} in game {game_code}")

        # Emit answer submitted event to all players
        emit('answer_submitted', {
            'player_id': player_id,
            'nickname': active_games[game_code]['players'][player_id]['nickname'],
            'answer': answer
        }, room=game_code)

        # Update remaining time for all players
        if 'timer_end' in active_games[game_code]:
            remaining_time = (active_games[game_code]['timer_end'] - datetime.now()).total_seconds()
            emit('timer_update', {'remaining_time': max(0, remaining_time)}, room=game_code)

@socketio.on('broadcast_question')
def handle_broadcast_question(data):
    game_code = data['game_code']
    question_data = data['question']

    if game_code in active_games:
        logging.info(f"Broadcasting new question in game {game_code}")

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

        logging.info(f"Question broadcast complete for game {game_code}")

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


# Add socket handler for clearing feedback
@socketio.on('clear_feedback')
def handle_clear_feedback(data):
    """Handle clearing of feedback when host continues the video."""
    try:
        game_code = data['game_code']
        if game_code not in active_games:
            logging.warning(f"Clear feedback called for non-existent game: {game_code}")
            return
            
        logging.info(f"Game {game_code}: Processing clear feedback request")
        
        # Reset all question and feedback-related state
        active_games[game_code]['feedback_shown'] = False
        active_games[game_code]['phase'] = 'playing'
        active_games[game_code]['current_question'] = None
        
        # Ensure submitted_answers exists and is empty
        active_games[game_code]['submitted_answers'] = []
        
        # Cancel any lingering timers
        if 'current_timer' in active_games[game_code] and active_games[game_code]['current_timer']:
            try:
                active_games[game_code]['current_timer'].cancel()
            except:
                pass
            active_games[game_code]['current_timer'] = None
        
        # Update activity timestamp
        active_games[game_code]['last_activity'] = datetime.now()

        # Notify all players that feedback has been cleared
        logging.info(f"Game {game_code}: Clearing feedback state")
        emit('feedback_cleared', {}, room=game_code, broadcast=True)
        
        logging.info(f"Game {game_code}: Feedback cleared successfully")
    except Exception as e:
        logging.error(f"Error handling clear_feedback: {str(e)}")
        # Try to recover if possible
        try:
            if 'game_code' in data and data['game_code'] in active_games:
                emit('feedback_cleared', {}, room=data['game_code'])
                logging.info(f"Sent recovery feedback clear to game {data['game_code']}")
        except:
            logging.error("Failed to send recovery feedback clear message")

# Clean up disconnected games periodically
def cleanup_inactive_games():
    """Remove games that have been inactive for more than 2 hours"""
    current_time = datetime.now()
    games_to_remove = []

    for game_code, game in active_games.items():
        # If game has no activity timestamp or is more than 2 hours old
        if 'last_activity' not in game or (current_time - game['last_activity']).total_seconds() > 7200:
            games_to_remove.append(game_code)

    for game_code in games_to_remove:
        del active_games[game_code]
        logging.info(f"Removed inactive game {game_code}")

# Schedule cleanup every hour
def schedule_cleanup():
    cleanup_inactive_games()
    threading.Timer(3600, schedule_cleanup).start()

# Start cleanup scheduler
schedule_cleanup()

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