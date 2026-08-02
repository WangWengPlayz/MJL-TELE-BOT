# Quick Setup Guide

## ⚡ 30-Second Setup

### Step 1: Add Bot Token
Create a `.env` file in the project root:
```
BOT_TOKEN=your_bot_token_from_botfather
```

### Step 2: Verify Config
Check `config.json` has your admin ID (already set to: **8787610218**):
```json
{
  "adminId": 8787610218,
  "prefix": "/"
}
```

### Step 3: Start the Bot
```bash
npm start
```

✅ Done! You should see startup messages in the console AND receive a notification from the bot in Telegram!

---

## 📋 Configuration Reference

**File**: `config.json`

| Setting | Value | Purpose |
|---------|-------|---------|
| `prefix` | `/` | What character(s) start commands |
| `adminId` | `8787610218` | Your Telegram ID (receives notifications) |
| `adminName` | `Owner` | How you're referred to in the bot |
| `logAdminNotifications` | `true/false` | Send startup alerts to admin |
| `botName` | `MJL Bot` | Bot name in notifications |

---

## 🔧 Common Changes

### Change Command Prefix to `!`
```json
"prefix": "!"
```
Now use: `!ping`, `!help`, etc.

### Disable Startup Notifications
```json
"logAdminNotifications": false
```

### Change Bot Name
```json
"botName": "My Custom Bot"
```

---

## 🆘 Troubleshooting

**Bot not responding?**
- ✅ Check `BOT_TOKEN` is set in `.env`
- ✅ Check `config.json` exists in project root
- ✅ Check console for error messages
- ✅ Try sending a command like `/help`

**Not receiving admin notifications?**
- ✅ Verify `adminId` is set to your Telegram user ID
- ✅ Verify `logAdminNotifications` is `true`
- ✅ Check bot can actually send messages in your chat

**Commands say "Unknown command"?**
- ✅ Make sure you're using the right prefix (check `config.json`)
- ✅ Verify command files exist in `/commands` folder
- ✅ Check console logs show commands loaded

---

## 📞 Your Config

- **Your Admin ID**: `8787610218`
- **Prefix**: `/` (type `/ping` or `/help`)
- **Bot Name**: `MJL Bot`

All settings are in `config.json` — edit anytime and restart the bot!
