import os
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

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET")
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

logging.basicConfig(level=logging.DEBUG)

# Initialize the OpenAI client
# the newest OpenAI model is "gpt-4o" which was released May 13, 2024.
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# Store active games in memory
active_games = {}

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
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        relevant_text = []
        end_time = current_time
        start_time = max(0, end_time - 60)
        
        for entry in transcript:
            if start_time <= entry['start'] <= end_time:
                relevant_text.append(entry['text'])
        
        return ' '.join(relevant_text)
    except Exception as e:
        logging.error(f"Error getting transcript: {str(e)}")
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
        
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        game_code = generate_game_code()
        
        while game_code in active_games:
            game_code = generate_game_code()
        
        active_games[game_code] = {
            'video_id': video_id,
            'host_id': None,
            'players': {},
            'current_question': None,
            'phase': 'lobby',
            'settings': {
                'question_type': 'closed',
                'difficulty': '6'
            }
        }
        
        return jsonify({
            "success": True,
            "game_code": game_code,
            "video_id": video_id
        })
    except Exception as e:
        logging.error(f"Error creating game: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Could not create game. Make sure the video has closed captions available."
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
@socketio.on('connect')
def handle_connect():
    logging.info('Client connected')

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

@socketio.on('submit_answer')
def handle_submit_answer(data):
    game_code = data['game_code']
    player_id = data['player_id']
    answer = data['answer']
    
    if game_code in active_games and player_id in active_games[game_code]['players']:
        emit('answer_submitted', {
            'player_id': player_id,
            'nickname': active_games[game_code]['players'][player_id]['nickname'],
            'answer': answer
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

@socketio.on('broadcast_question')
def handle_broadcast_question(data):
    game_code = data['game_code']
    question_data = data['question']

    if game_code in active_games:
        active_games[game_code]['current_question'] = question_data
        emit('new_question', question_data, room=game_code)

if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)