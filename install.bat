@echo off
set "PATH=C:\Program Files\nodejs;C:\Users\Sentra\AppData\Local\Programs\Python\Python311;C:\Users\Sentra\AppData\Local\Programs\Python\Python311\Scripts;%PATH%"

echo "Checking Python version..."
python --version

echo "Checking NPM version..."
npm --version

echo "Installing Backend Dependencies..."
cd backend
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..

echo "Installing Frontend Dependencies..."
cd frontend
npm install
cd ..
