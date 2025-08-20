# Sebov Autofill

Sebov Autofill is a lightweight, open-source Firefox extension that saves form inputs on any site and autofills them later.  
Perfect for quickly reusing frequently entered data without relying on external password managers or bloated solutions.

## Features

- **Save forms per site** – capture all visible, non-password fields.  
- **Quick autofill** – instantly restore saved values with a shortcut or popup.  
- **Multiple profiles per site** – store different form variants (e.g. "Work", "Personal").  
- **Profile manager** – switch active profile, delete unused ones, or clear all with one click.  
- **Keyboard shortcut** – default: `Alt+Shift+L` (configurable in Firefox).  
- **Import & Export** – back up your saved profiles to JSON or move them between browsers.  
- **Privacy-friendly** – all data is stored locally in your browser, never uploaded.

## Permissions

The extension requires the following permissions:

- `storage` — save and retrieve form data locally.  
- `tabs` and `activeTab` — interact with the current page for autofill.  
- `downloads` — enable exporting saved profiles to a JSON file.  
- `<all_urls>` — allow form capture and autofill on any site you choose.  

## Privacy

All form data is stored locally in your browser. The extension does not transmit, sync, or upload any of your data to external servers.  
