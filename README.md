# CKBull Discord Agent

A comprehensive Discord bot assistant that integrates with the Nervos ecosystem. It uses the OpenAI API to manage conversational interactions, processes various file formats (PDFs, images, CSVs) to extract text, and manages scheduled tasks for dynamic content updates and responses. The bot also leverages documentation from associated repositories to enrich its responses.

---

## Features

- **Interactive Assistant:**  
  Engage in real-time, context-based conversations on Discord using OpenAI-powered responses.

- **File Conversion & OCR:**  
  Converts non-text files (PDFs, images, CSVs) to text using [pdf-parse](https://www.npmjs.com/package/pdf-parse) and [Tesseract.js](https://tesseract.projectnaptha.com/).

- **Scheduled Content:**  
  Supports scheduling of prompts through cron jobs so that assistant messages can be sent automatically in specified channels.

- **Documentation Integration:**  
  Automatically updates and integrates related documentation (e.g., Nervos docs, CKBull user/developer guides) to provide rich, contextual answers. See details in `repos.config.json`.

- **Backup & Export:**  
  Includes a script to generate a comprehensive report (`repo_report.txt`) that outlines the repository structure and major file contents.

---

## Repository Structure

```
.
├── .env.example
├── .gitignore
├── ManualFolder
│   └── ckbull-docs
│       ├── CKBull_How_its_Made.pdf
│       ├── CKBull_How_its_Made.txt
│       ├── ckbull-roadmap-txt
│       ├── ferran-at-ckcon.txt
│       ├── joan-docs.txt
│       └── what-is-ckbull.txt
├── README.md
├── backup_and_export.sh
├── eng.traineddata
├── package.json
├── repo_report.txt
├── repos.config.json
├── src
│   ├── assistantClient.ts
│   ├── assistantGlobals.ts
│   ├── assistantManager.ts
│   ├── assistantRunner.ts
│   ├── cliUtils.ts
│   ├── commands
│   │   ├── bullManager.ts
│   │   └── deploy-commands.ts
│   ├── convertNonTextToTxt.ts
│   ├── docsUpdater.ts
│   ├── fileProcessor.ts
│   ├── index.ts
│   ├── messageProcessor.ts
│   ├── scheduler.ts
│   └── threadHandler.ts
├── tsconfig.json
└── vectorStoreId.txt
```

---

## Prerequisites

- **Node.js:** Version 14 or later (Node.js v16+ is recommended)
- **npm or yarn:** To manage dependencies

*Environment Variables*  
Ensure that you set up the following environment variables (you can use the provided `.env.example` as a template):

- `DISCORD_BOT_TOKEN` – Your Discord bot token.
- `OPENAI_API_KEY` – Your OpenAI API key.
- `ASSISTANT_API_BASE` – URL to the OpenAI assistant API endpoint (e.g., `https://api.openai.com/v1/assistants`).
- `ASSISTANT_FILES_API_BASE` – URL for file uploads to the assistant service.
- `CLIENT_ID` – Your Discord application's client ID.
- `GUILD_ID` (optional) – For guild-specific slash commands.

---

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/your-username/ckbull_discord_agent.git
   cd ckbull_discord_agent
   ```

2. **Install Dependencies:**

   ```bash
   npm install
   ```

3. **Configure Environment Variables:**

   - Copy the example environment file:
     ```bash
     cp .env.example .env
     ```
   - Update the `.env` file with your credentials and configuration details.

---

## Usage

### Starting the Bot

Run the following command to start the bot:

```bash
npm start
```

Upon starting, the bot will:
- Log in to Discord.
- Initialize the assistant, update documentation, and set up scheduled content based on the configuration.
- Listen for messages and commands to manage assistant conversations.

### Commands

- **Text Commands:**
  - `!askbull` – Initiates a stateless assistant conversation.
  - `!askbullthread` or `!askbullprivatethread` – Starts a dedicated conversation thread for more focused interactions.

- **Slash Commands (via Discord):**
  - `/bullmanager update` – Updates assistant docs by re-uploading files and resetting the vector store.
  - `/bullmanager add` – Adds new scheduled content interactively.
  - `/bullmanager toggle` – Toggles the status (active/paused) of a scheduled content job.
  - `/bullmanager list` – Lists all scheduled content jobs.

---

## Scheduled Content

The project supports scheduling assistant prompts using cron-like expressions. Scheduled jobs automatically send assistant responses to the designated channel. To configure or modify these jobs, review the code in `src/scheduler.ts` and use the slash commands provided by the `bullManager` command group.

---

## Backup & Export

The script `backup_and_export.sh` generates a detailed report (`repo_report.txt`) that documents the repository structure and key file contents. To run the backup:

```bash
./backup_and_export.sh
```

---

## Related Repositories

This project integrates documentation from several related repositories. Check out the repositories listed in `repos.config.json`:

- [nervos-docs](https://github.com/nervosnetwork/docs)
- [ckbull-signer-docs](https://github.com/vriveraPeersyst/ckbull-developer-panel.git)
- [ckbull-spore-nfts-docs](https://github.com/sporeprotocol/spore-docs.git)

---

## Development & Contributing

- **TypeScript:** The project is entirely written in TypeScript.
- **Modular Codebase:** The code is organized into distinct modules for assistant logic, file processing, scheduling, and command handling.
- Contributions are welcome! Please open issues or submit pull requests with improvements or bug fixes.

---

## License

This project is licensed under the ISC License.

---

## Acknowledgements

- [Discord.js](https://discord.js.org/)
- [OpenAI API](https://openai.com/)
- [pdf-parse](https://www.npmjs.com/package/pdf-parse)
- [Tesseract.js](https://tesseract.projectnaptha.com/)

---

Happy coding and enjoy building with CKBull Discord Agent!