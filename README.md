```markdown
# XRPL EVM Discord Docs Assistant

A Discord bot that leverages OpenAI’s assistant APIs to provide dynamic, documentation-driven help for XRPL EVM. The bot periodically pulls and updates documentation from a GitHub repository, processes Markdown files into plain text, uploads them to a vector store, and powers an assistant that responds to user queries via Discord slash commands.

## Features

- **Automated Documentation Updates**  
  Clones/updates the XRPL EVM docs from GitHub, converts Markdown to plain text, and refreshes the vector store.

- **OpenAI Assistant Integration**  
  Creates or updates an assistant using OpenAI’s APIs that can search your docs and provide detailed responses.

- **Discord Slash Commands**  
  Provides a `/xrplevm` command for users to ask questions about XRPL EVM documentation directly from Discord.

- **Enhanced Prompt Input Support**  
  Accepts not only text input but also file attachments. Users can attach documents (`.txt`, `.md`, `.pdf`, `.csv`) or images. Image attachments are processed with OCR (via Tesseract.js) to extract text for the prompt.

- **Backup & Export Script**  
  Includes a shell script (`backup_and_export.sh`) to generate a report of the repository structure and key file contents.

- **Themed Documentation Portal**  
  The `docs` folder contains a Redocly-based portal for browsing XRPL EVM documentation (the contents of this folder are ignored in version control via `.gitignore`).

## Repository Structure

```
.
├── .env                           # Environment configuration (not committed)
├── assistantClient.ts             # Functions for file uploads, vector store management, and assistant API interactions
├── backup_and_export.sh           # Script to generate a repo report
├── deploy-commands.ts             # Script to deploy Discord slash commands
├── docs/                          # Documentation portal source (fully ignored by .gitignore)
│   ├── [various files and subdirectories]
├── docsUpdater.ts                 # Updates the local docs repo and converts Markdown files to text
├── index.ts                       # Main entry point for the Discord bot
├── package.json                   # Project metadata and dependencies
├── repo_report.txt                # Generated repository report
└── tsconfig.json                  # TypeScript configuration
```

## Setup

### Prerequisites

- **Node.js** (v14 or higher)
- **Yarn** or **npm**
- An **OpenAI API key** with access to the beta "assistants" endpoints
- A **Discord Bot token**, application (client) ID, and guild ID (for testing slash commands)
- A GitHub repository URL for the XRPL EVM docs

### Installation

1. **Clone the Repository**

   ```bash
   git clone https://github.com/yourusername/xrplevm_discord_agent.git
   cd xrplevm_discord_agent
   ```

2. **Install Dependencies**

   ```bash
   npm install
   # or if you prefer yarn:
   yarn install
   ```

   > **Note:** This project uses additional dependencies for file processing:
   > - **pdf-parse** for processing PDF files
   > - **Tesseract.js** for extracting text from images

3. **Configure Environment Variables**

   Create a `.env` file in the project root with the following content (replace placeholders with your actual values):

   ```ini
   # OpenAI API Configuration
   OPENAI_API_KEY=your_openai_api_key
   ASSISTANT_API_BASE=https://api.openai.com/v1/assistants
   ASSISTANT_FILES_API_BASE=https://api.openai.com/v1/files

   # Discord Bot Configuration
   DISCORD_BOT_TOKEN=your_discord_bot_token
   CLIENT_ID=your_bot_client_id
   GUILD_ID=your_test_guild_id   # For testing slash commands
   TARGET_CHANNEL_ID=optional_discord_channel_id

   # Docs Updater Configuration
   GITHUB_REPO=https://github.com/ripple/docs.xrplevm.org.git
   DOCS_LOCAL_PATH=./docs
   ```

4. **Deploy Discord Slash Commands**

   Run the deploy script to register the `/xrplevm` command:

   ```bash
   ts-node deploy-commands.ts
   ```

5. **Start the Bot**

   Start the bot, which will also update the docs on startup:

   ```bash
   ts-node index.ts
   ```

   On startup, the bot will:
   - Clone or update the XRPL EVM docs repository.
   - Convert Markdown files to text.
   - Upload text files to a vector store.
   - Create or update the OpenAI assistant.
   - Log into Discord and listen for `/xrplevm` commands.

## Usage

### Interacting on Discord

Use the slash command to ask questions about XRPL EVM docs:

```
/xrplevm prompt:"Your question about XRPL EVM"
```

You can also attach a file or image to supply additional context:
- **Document Attachment:** Attach a `.txt`, `.md`, `.pdf`, or `.csv` file containing your query or extra details.
- **Image Attachment:** Attach an image file; the bot will extract text from the image using OCR before processing your prompt.

If the bot's response is too long, it will be sent as an attached text file.

### Backup & Export

To generate a report of the repository structure and important file contents, run:

```bash
bash backup_and_export.sh
```

This will create a `repo_report.txt` file in the repository root.

## Development & Contributing

- The project is written in TypeScript. Contributions, bug reports, and pull requests are welcome.
- The repository includes a `.gitignore` that excludes:
  - Common files (e.g., `node_modules`, logs, build outputs, OS and editor artifacts)
  - Environment variable files (e.g., `.env`)
  - **All content inside the `docs` folder** (to prevent committing generated or third-party documentation portal assets)

Feel free to modify the `.gitignore` as needed.

## License

- The main project is licensed under **ISC** (see `package.json`).
- The documentation portal in the `docs` folder is licensed under **MIT** (see `docs/package.json`).

## Acknowledgments

- **OpenAI** for providing powerful APIs that enable assistant-driven interactions.
- The **XRPL** and **EVM** communities for their continuous contributions and support.

---

Happy coding and enjoy exploring XRPL EVM docs with your new Discord assistant!
```