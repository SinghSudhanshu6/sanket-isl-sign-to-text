# Deploy on PythonAnywhere
1. Upload/clone the project; create a virtualenv: `mkvirtualenv sanket --python=python3.11 && pip install -r backend/requirements.txt`.
2. `backend/.env`: `DJANGO_DEBUG=0`, a real `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS=yourname.pythonanywhere.com`, optional `ANTHROPIC_API_KEY`.
3. `python manage.py migrate && python manage.py load_vocab && python manage.py collectstatic`
4. Web tab: source = `.../sanket/backend`, virtualenv set, WSGI file: `from sanket_project.wsgi import application` (with `backend` on `sys.path`).
5. Static files mapping: URL `/static/` → `.../backend/staticfiles/`. (Includes the ~24 MB MediaPipe files; free accounts allow it.)
6. In the extension side panel set Backend URL to `https://yourname.pythonanywhere.com`. Free accounts only reach whitelisted hosts; api.anthropic.com is whitelisted.
