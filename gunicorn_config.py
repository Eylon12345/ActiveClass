import multiprocessing
import os
import logging

logging.basicConfig(level=logging.DEBUG)
logging.info("Loading custom Gunicorn configuration...")

# Worker Settings
worker_class = "eventlet"  # Using eventlet for WebSocket support
workers = 1  # Single worker for WebSocket support
worker_connections = 1000
timeout = 120
keepalive = 65

# Binding
bind = "0.0.0.0:5000"

# Logging
loglevel = "debug"
accesslog = "-"
errorlog = "-"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Application specific settings
raw_env = [
    "RUNNING_IN_PRODUCTION=true",
]

preload_app = True
reload = False

def on_starting(server):
    logging.info(f"Starting Gunicorn with {worker_class}")

def post_worker_init(worker):
    logging.info(f"Worker initialized with class: {worker.__class__.__name__}")

def worker_abort(worker):
    logging.error(f"Worker aborted: {worker.pid}")