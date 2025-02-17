# CKBull Discord Agent

A Discord bot that leverages OpenAI's assistant API to provide contextual assistance for CKBull users. It processes text and file attachments (including PDFs and images via OCR), integrates a vector store for document search, and manages both stateless and threaded conversations on Discord.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Bot Commands](#bot-commands)
  - [File Processing & Assistant Interaction](#file-processing--assistant-interaction)
- [Scripts](#scripts)
- [Repository Structure](#repository-structure)
- [License](#license)

---

## Features

- **Discord Integration:**  
  Connects to Discord using a bot token and listens for commands and messages.

- **Assistant API Integration:**  
  Communicates with the OpenAI assistant API to create/update an assistant using a vector store and file search capabilities.

- **Document Processing:**  
  - Uploads files to the assistant API.
  - Extracts text from PDFs, text/markdown documents, CSV files, and images (using OCR with Tesseract).

- **Threaded Conversations:**  
  Supports both stateless single-message conversations and multi-message threaded conversations (public or private).

- **Automatic Docs Update:**  
  Updates and converts documentation from GitHub to keep the assistant up-to-date with relevant content.

- **Backup & Export:**  
  Generates a comprehensive repository report including the file structure and contents using the `backup_and_export.sh` script.

---

## Prerequisites

- **Node.js** (v14 or later)
- **npm** (or your preferred Node package manager)
- **TypeScript**

---

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/ckbull_discord_agent.git
   cd ckbull_discord_agent
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Compile TypeScript (if needed):**

   ```bash
   npx tsc
   ```

---

## Configuration

1. **Environment Variables:**  
   Copy the provided environment example file and update it with your credentials.

   ```bash
   cp .env.example .env
   ```

2. **Required Environment Variables:**

   - `DISCORD_BOT_TOKEN` – Your Discord bot token.
   - `OPENAI_API_KEY` – Your OpenAI API key.
   - `ASSISTANT_API_BASE` – Base URL for the assistant API (e.g., `https://api.openai.com/v1/assistants`).
   - `ASSISTANT_FILES_API_BASE` – Base URL for file upload endpoints (e.g., `https://api.openai.com/v1/files`).

---

## Usage

### Bot Commands

Once the bot is running, you can interact with it via Discord using the following commands:

- **`!askbull`**  
  Sends a single-message (stateless) query to the assistant.  
  _Example:_  
  ```text
  !askbull How do I set up my wallet?
  ```

- **`!askbullthread`**  
  Initiates a public thread-based conversation with context.

- **`!askbullprivatethread`**  
  Starts a private thread-based conversation.

*Note: The bot automatically handles replies in existing threads to continue the conversation context.*

### File Processing & Assistant Interaction

- **Attachments:**  
  The bot supports various file types:
  - **Documents:** `.txt`, `.md`, `.pdf`, `.csv`
  - **Images:** `.png`, `.jpg`, `.jpeg`, `.gif` (processed via OCR using Tesseract)

- **Assistant Conversation:**  
  The bot processes message content and attachments, constructs a conversation context, and then interacts with the assistant API to generate a reply. If the response is too lengthy, it will be sent as a text file attachment.

---

## Scripts

- **`npm run start`**  
  Starts the bot using `ts-node` (as defined in `package.json`).

- **`backup_and_export.sh`**  
  Generates a report (`repo_report.txt`) containing the repository structure and file contents.  
  _Usage:_  
  ```bash
  ./backup_and_export.sh
  ```

---

## Repository Structure

```
.
├── .env.example
├── .gitignore
├── backup_and_export.sh
├── package.json
├── repo_report.txt
├── src
│   ├── assistantClient.ts      # Handles assistant API interactions and file uploads
│   ├── docsUpdater.ts          # Updates docs from GitHub and converts markdown to text (implementation details)
│   └── index.ts                # Main entry point; sets up the Discord client and command handling
└── tsconfig.json
```

---

## License

This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.