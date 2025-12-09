# CS 375 Web Development Project

## Setup

To launch the app, follow these steps:

1. Install dependencies (if you haven’t already):

   ```bash
   npm install
## Prerequisites

- **Node.js** v18 or higher  
- **npm** v9 or higher  
- A modern browser (Chrome, Firefox, or Edge recommended)

## Database Setup

This project requires a PostgreSQL database configured for user authentication and Spotify integration.

### 1. Create a PostgreSQL Database

You can create the database using `psql`:
```bash
createdb garden
```

### 2. Create the `users` Table

The SQL schema for the `users` table is included in `app/db/create_users.sql`.

Run the following command from the project root:

```bash
# Run this only if you have existing tables that are outdated and want them removed. 
psql -U postgres -d garden -c "DROP TABLE IF EXISTS user_tracks, tracks, comments, posts, friendships, users CASCADE;"

# Run this to create the tables
psql -U postgres -d garden -f app/db/create_users.sql
```

### 3. Configure `env.json`

Your `env.json` file should be located in the `app/` directory and include the database connection credentials and Spotify API keys:

```json
{
  "user": "postgres",
  "password": "your_password",
  "host": "localhost",
  "port": 5432,
  "database": "garden",
  "spotify": {
    "clientId": "will_email_this",
    "clientSecret": "will_email_this",
    "redirectUri": "http://127.0.0.1:8000/auth/spotify/callback"
  }
}
```

### 4. Verify the Connection

You can do (`npm run start`), or cd into the app folder and start the server (`node server.js`). Once you start the server, you should see a message like:

```
Connected to database garden
```

This indicates the PostgreSQL pool connection was successfully established.


## 5. Opening the app

The app should be accessible at [http://localhost:8000/login.html](http://localhost:8000/login.html)