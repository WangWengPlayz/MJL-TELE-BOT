# Bot Configuration

The bot uses `config.json` for all configurable settings.

## config.json

```json
{
  "prefix": "/",
  "adminId": 8787610218,
  "adminName": "Owner",
  "logAdminNotifications": true,
  "botName": "MJL Bot"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `prefix` | string | Command prefix (default: `/`) |
| `adminId` | number | Telegram User ID of the bot admin - receives startup notifications |
| `adminName` | string | Display name for the admin |
| `logAdminNotifications` | boolean | Whether to send startup notifications to admin |
| `botName` | string | Display name of the bot (used in admin notifications) |

## Environment Variables

The following environment variables are required:

- `BOT_TOKEN` - Your Telegram bot token from [@BotFather](https://t.me/botfather)
- `WEBHOOK_SECRET` (optional) - Secret token for webhook validation in Vercel mode

## Startup Behavior

When the bot comes online:
1. It logs all loaded commands to the console
2. If `logAdminNotifications` is `true`, it sends a message to the admin user ID with:
   - Current timestamp
   - Number of commands loaded
   - Current prefix
   - Operating mode (polling or webhook)

## Example: Change Command Prefix

Edit `config.json`:
```json
{
  "prefix": "!",
  ...
}
```

Now use `!ping`, `!help`, etc. instead of `/ping`, `/help`.

## Example: Disable Admin Notifications

Edit `config.json`:
```json
{
  "logAdminNotifications": false,
  ...
}
```

## Quick Start

1. Set `BOT_TOKEN` in your `.env` file
2. Update `config.json` with your admin ID and desired settings
3. Run `npm start`
