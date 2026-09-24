# Database Manager

A Visual Studio Code extension to configure, connect and manage databases directly from the editor.

Supports **MySQL**, **MariaDB**, **PostgreSQL** and **SQLite**.

## Features

### Connection Manager (Activity Bar)

- Dedicated **Database Manager** icon in the Activity Bar.
- **Connection Manager** view: GUI to add, edit, test, save, connect and disconnect connections.
- **Connections** tree: browse databases → tables → columns of connected databases.

### Supported databases

| Type       | Driver                               | Notes                          |
| ---------- | ------------------------------------ | ------------------------------ |
| MySQL      | `mysql2` (bundled)                   |                                |
| MariaDB    | `mysql2` (bundled, MySQL protocol)   |                                |
| PostgreSQL | `pg` (bundled)                       | SSL/TLS supported              |
| SQLite     | Node built-in `node:sqlite`          | Picks a local database file    |

## Getting started

1. Click the **Database Manager** icon in the Activity Bar.
2. In the **Connection Manager** panel, click **New** and fill in the form.
3. Click **Test Connection** to validate the settings, then **Save Connection**.
4. Use **Connect** to open the connection and browse it from the **Connections** tree.

### SQLite

Select a `.sqlite`/`.db` file with **Browse…**, or type a path. The file is created if it does not exist.

## Security

Connection passwords are stored in VS Code's secure **SecretStorage**, never in plain text on disk.

## Requirements

- Visual Studio Code `^1.85.0`
- Node.js `>= 22.5` for the built-in SQLite support (bundled with current VS Code releases)

## Extension Settings

| Setting                                | Default | Description                                        |
| -------------------------------------- | ------- | -------------------------------------------------- |
| `database-manager.maxTableRows`        | `1000`  | Maximum rows fetched when viewing table data.      |
| `database-manager.hideSystemDatabases` | `true`  | Hide system databases/schemas in the tree.         |

## Release Notes

### 0.0.1

- Initial release: configure, test and connect to MySQL, MariaDB, PostgreSQL and SQLite.
- Browse databases, tables and columns of connected servers.

**Enjoy!**