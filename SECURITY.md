# Security Checklist

This project is a static frontend connected to Firebase. Before making the repository public, review the following items carefully.

## 1. Firebase configuration

Firebase web configuration values such as `apiKey`, `authDomain`, `databaseURL`, and `projectId` are usually exposed in client-side Firebase apps. They are not the same as server secrets.

However, public Firebase config becomes risky if Realtime Database rules are too open.

## 2. Realtime Database rules

Make sure unauthenticated users cannot freely read or write the entire database.

Recommended rule direction:

- Parents should only read the family/student records allowed by their family code flow.
- Admin write access should require Firebase Authentication.
- Avoid broad rules such as `.read: true` and `.write: true` in production.

## 3. Never commit these files

Do not commit:

```text
.env
.env.*
serviceAccount*.json
firebase-debug.log
*.log
```

## 4. Review personal information

Before switching to a public repository, check for:

- Student names
- Family codes
- Bank account number
- Account holder name
- Phone numbers
- Parent messages
- Learning reports
- Exported CSV / JSON / PDF files
- Screenshots showing private data

## 5. Recommended GitHub workflow

1. Push to a **private** repository first.
2. Review source code and Firebase rules.
3. Replace real sample data with anonymized demo data.
4. Add screenshots only after removing private information.
5. Switch to public only when the project is safe for portfolio viewing.


## Sanitized GitHub setup

This public-safe package moves Firebase config, fallback passcodes, student metadata, parent app URL, and payment defaults into `config.example.js` / local `config.js`.

Keep `config.js` local. It is intentionally ignored by Git.
