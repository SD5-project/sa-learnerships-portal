# SkillsConnect sa-learnership
> Connects people

## Table of Contents

- [About](#about)
- [Live Application](#live-application)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Clone the Repository](#clone-the-repository)
  - [Backend Setup](#backend-setup)
- [Running the Application](#running-the-application)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)

---

## About

Allows providers to post learnership opportunities and have people sign up for them

---

## Live Application

The application is publicly hosted and accessible at:

**URL:** [https://skillsconnect-eqdgb0fxdxa8geap.southafricanorth-01.azurewebsites.net/](https://skillsconnect-eqdgb0fxdxa8geap.southafricanorth-01.azurewebsites.net/)

| Role | Email | Password |
|------|-------|----------|
| Applicant | `alexk421356@gmail.com` | `Password123` |
| Provider | `irogakxela@gmail.com` | `Password123` |
| Admin | `dibakoanetshimollo@gmail.com` | `Password123` |

---

## Prerequisites

Make sure you have the following installed before proceeding:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) (v9 or higher)
- [Git](https://git-scm.com/)

---

## Getting Started

### Clone the Repository

```bash
git clone https://github.com/SD5-project/sa-learnerships-portal.git
cd sa-learnerships-portal
```

### Backend Setup

```bash
# Navigate to the backend directory
cd backend

# Install dependencies
npm install

# Copy the example environment file and fill in your values
cp .env.example .env
```

> See [Environment Variables](#environment-variables) for details on what to fill in.

---

## Running the Application

```bash
cd backend
nodemon app.js
```

The server will start at `http://localhost:5000` and serve the full application.

---

## Environment Variables

Create a `.env` file in the `backend/` directory based on `.env.example`. The required variables are:

| Variable | Description |
|----------|-------------|
| `EMAIL_HOST` | SMTP host (e.g. `smtp-relay.brevo.com`) |
| `EMAIL_USER` | Your Brevo SMTP username |
| `EMAIL_PASS` | Your Brevo SMTP password |

> SMTP credentials can be obtained by creating a free account at [Brevo](https://www.brevo.com) and navigating to **SMTP & API → SMTP**.

---

## Project Structure

```
sa-learnership/
├── backend/                # Node.js backend (serves full app)
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   └── app.js
├── frontend/               # React frontend
│   ├── public/
│   └── src/
│       ├── components/
│       ├── pages/
│       └── App.js
├── docs/                   # Project documentation & artefacts
└── README.md
```

---

*University of the Witwatersrand — School of Computer Science and Applied Mathematics*
