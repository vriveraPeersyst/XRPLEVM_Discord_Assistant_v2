# XRPL EVM Discord Agent

The **XRPL EVM Discord Agent** is a Discord bot that assists users, developers, and operators in interacting with XRPL EVM documentation. It leverages OpenAI's API, a vector store for efficient document search, and supports rich file processing (including PDFs and images via OCR) to provide context-aware answers from the XRPL EVM docs.

---

## Features

- **Assistant Integration:**  
  Create or update an AI assistant tailored for XRPL EVM documentation using OpenAI's API.

- **Vector Store Management:**  
  Upload documentation files, create a vector store, and add files to enable efficient file search and retrieval.

- **Rich File Processing:**  
  Automatically extract text from various file formats:
  - **Documents:** `.txt`, `.md`, `.pdf`, `.csv`
  - **Images:** `.png`, `.jpg`, `.jpeg`, `.gif` (via Tesseract OCR)

- **Threaded Conversations:**  
  Supports both stateless and threaded conversation modes in Discord:
  - **Stateless Command:** Direct one-off queries.
  - **Thread-Based Conversations:** Maintain context in public or private threads.

- **Automated Documentation Updates:**  
  Fetches and converts documentation from GitHub to keep the assistant up-to-date.

- **Backup & Export:**  
  A handy shell script to generate a comprehensive report of the repository structure and key file contents.

---

## Repository Structure

```plaintext
.
├── .env                   # Environment configuration (create from .env.example)
├── .env.example           # Sample environment configuration
├── .gitignore             # Files and folders to be ignored by Git
├── README.md              # This readme file
├── assistantClient.ts     # API client for file uploads, vector store, and assistant interactions
├── backup_and_export.sh   # Script to generate a repository report (structure & file contents)
├── docsUpdater.ts         # Module to update documentation from GitHub and convert Markdown to text
├── eng.traineddata        # Tesseract OCR training data for English
├── index.ts               # Main entry point for the Discord bot
├── package.json           # Project metadata and dependencies
└── tsconfig.json          # TypeScript configuration
```

---

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/yourusername/xrplevm_discord_agent.git
   cd xrplevm_discord_agent
   ```

2. **Install Dependencies:**

   ```bash
   npm install
   ```

3. **Configure Environment Variables:**

   - Copy the example file to create your own `.env`:

     ```bash
     cp .env.example .env
     ```

   - Update the `.env` file with your credentials and configuration:

     ```dotenv
     # OpenAI API Configuration
     OPENAI_API_KEY=your_openai_api_key
     ASSISTANT_API_BASE=https://api.openai.com/v1/assistants
     ASSISTANT_FILES_API_BASE=https://api.openai.com/v1/files

     # Discord Bot Configuration
     DISCORD_BOT_TOKEN=your_discord_bot_token
     CLIENT_ID=your_bot_client_id
     GUILD_ID=your_test_guild_id   # For testing slash commands

     # Docs Updater Configuration
     GITHUB_REPO=https://github.com/ripple/docs.xrplevm.org.git
     DOCS_LOCAL_PATH=./docs
     ```

   - **Note:**  
     Make sure to replace the placeholder values with your actual API keys and IDs.

---

## Usage

### Starting the Bot

Start the Discord bot using:

```bash
npm start
```

On startup, the bot will:
- Log in to Discord.
- Update documentation from GitHub.
- Create/update the XRPL EVM assistant with the latest docs.

### Commands

The bot listens for commands prefixed with `!`:

- **`!xrplevm`**  
  *Stateless Query:*  
  Sends a one-off query (including any attached files/images) to the assistant.
  
  **Usage:**  
  ```plaintext
  !xrplevm [your query here]
  ```

- **`!xrplevmthread`**  
  *Public Thread Conversation:*  
  Starts or continues a conversation in a public thread.
  
  **Usage:**  
  ```plaintext
  !xrplevmthread [your query here]
  ```

- **`!xrplevmprivatethread`**  
  *Private Thread Conversation:*  
  Starts or continues a conversation in a private thread.
  
  **Usage:**  
  ```plaintext
  !xrplevmprivatethread [your query here]
  ```

Additionally, messages within existing XRPL EVM conversation threads are automatically processed without needing a command prefix.

### Backup and Export

To generate a repository report (listing structure and key file contents), run:

```bash
./backup_and_export.sh
```

The output is saved as `repo_report.txt`.

---

## Development

- **Language:** TypeScript  
- **Execution:** Uses `ts-node` for running the TypeScript code  
- **Key Files:**
  - **`assistantClient.ts`:** Contains functions for interacting with the OpenAI API (file uploads, vector store, assistant management).
  - **`docsUpdater.ts`:** Handles updating documentation from GitHub and converting Markdown to text.
  - **`index.ts`:** Main bot logic, managing Discord interactions, command parsing, and thread conversations.

- **TypeScript Configuration:** See [`tsconfig.json`](./tsconfig.json).

### Running Locally

Ensure you have Node.js installed. Then start the bot:

```bash
npm start
```

Monitor the console for debug logs and status updates.

---

## Contributing

Contributions are welcome! Feel free to fork the repository and submit pull requests. When contributing:
- Adhere to the existing code style.
- Update documentation as needed.
- Test your changes thoroughly.

---

## License

This project is licensed under the ISC License.

---

## Acknowledgments

- Built with [discord.js](https://discord.js.org/) for Discord interactions.
- Powered by [OpenAI's API](https://openai.com/api/) for AI assistant functionality.
- Utilizes [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR capabilities.
- Inspired by the need for a dedicated assistant for XRPL EVM documentation.