# Long_Horizon_Memory_V2_Dashboard

A real-time monitoring dashboard for the Long Horizon Memory Agent training. Built with React, Tailwind CSS, and Framer Motion, with a MonkeyType-inspired "Serika Dark" theme.

## 🚀 Features

- **Real-time Monitoring**: Live updates of agent state transitions, rewards, and logs via WebSockets.
- **MonkeyType Aesthetic**: Clean, minimalist design with smooth animations.
- **Dynamic Graphs**: Visualize training progress and reward trends.
- **Dual Backend Support**: Automatically switches between local FastAPI and Hugging Face Space proxies.

## 🛠️ Architecture

This repository is designed for deployment on **Vercel**:
- **Frontend**: Static React application (Vite).
- **Backend**: Serverless Python functions (FastAPI) located in the `api/` directory.

## 📦 Deployment on Vercel

1.  Push this repository to GitHub.
2.  Import the project in Vercel.
3.  Vercel will automatically detect the configuration in `vercel.json`.
4.  The frontend will be served at the root, and the API will be available at `/api`.

## 🔧 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

## 🔗 Related Projects

- [Main Repository](https://github.com/Aditya-Ranjan1234/Long_Horizon_Memory_V2) - Core agent logic and training scripts.
- [Hugging Face Space](https://huggingface.co/spaces/aditya-ranjan1234/long-horizon-memory-v2) - Hosted environment for the agent.
