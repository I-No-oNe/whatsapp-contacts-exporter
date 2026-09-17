# WhatsApp Group Exporter

Chrome extension that exports the members of a WhatsApp Web group to `.xlsx` or CSV (`Number`, `Name`). Names are the ones members set in WhatsApp, not your saved contact names. Members with hidden numbers are skipped.

## Install

1. Download the latest zip from [Releases](../../releases) and unzip it
2. Open `chrome://extensions`, enable Developer mode, click Load unpacked and select the folder
3. Optional: enable Allow User Scripts in the extension details to let it update its WhatsApp library automatically

## Usage

Open [web.whatsapp.com](https://web.whatsapp.com), click the extension icon, pick a group and export.

## How it works

WhatsApp data is read through [@wppconnect/wa-js](https://github.com/wppconnect-team/wa-js). The extension checks npm for new wa-js releases, verifies the SHA-512 hash and only uses releases that are at least 3 days old. The copy in `lib/` is used as a fallback.
