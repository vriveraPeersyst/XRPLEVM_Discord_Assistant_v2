#!/usr/bin/env bash

# Name of the output file for the backup/export report
OUTPUT_FILE="repo_report.txt"

# Remove any existing output file to ensure a fresh report
rm -f "$OUTPUT_FILE"

#######################################
# 1. Generate and Append Repo Structure
#######################################
echo "====================================" >> "$OUTPUT_FILE"
echo "          REPO STRUCTURE            " >> "$OUTPUT_FILE"
echo "====================================" >> "$OUTPUT_FILE"

# Use the 'tree' command to list the repository structure.
#   -a : Include hidden files
#   -I : Ignore specified patterns
# Patterns ignored: node_modules, package-lock.json, various image files, .DS_Store,
# .git folder, abis (contract src/abis folder), and main.0d424902.js.
tree -a \
  -I "docs|node_modules|package-lock.json|*.ico|*.png|*.jpg|*.jpeg|*.svg|*.gif|.DS_Store|.git|abis|main.0d424902.js" \
  . >> "$OUTPUT_FILE" 2>/dev/null

#######################################
# 2. Append Contents of Important Files
#######################################
echo -e "\n\n====================================" >> "$OUTPUT_FILE"
echo "          FILE CONTENTS             " >> "$OUTPUT_FILE"
echo "====================================" >> "$OUTPUT_FILE"

# Find and append the contents of files with specific extensions.
# We ignore node_modules, package-lock.json, .git directories, and certain other files.
find . \
  -type f \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.sh" -o -name "*.json" \) \
  -not -path "*node_modules*" \
  -not -path "*docs*" \
  -not -name "package-lock.json" \
  -not -path "*/.git/*" \
  -not -path "*/src/abis/*" \
  -not -path "*/src/frontend/build/static/js/main.0d424902.js" \
  -print | while read -r file
do
  echo -e "\n-------- $file --------" >> "$OUTPUT_FILE"
  cat "$file" >> "$OUTPUT_FILE"
done

echo -e "\nDone! Report generated in '$OUTPUT_FILE'."
