# Database migration: users table

This folder contains a small SQL query's to create the `users`, `friendships`, `posts`, and `comments` tables.

Run (from a shell with psql).

```powershell (run this first to delete table and re-create it)
psql -U postgres -d garden -c "DROP TABLE IF EXISTS comments, posts, friendships, users CASCADE;"

psql -U postgres -d garden -f db/create_users.sql
```

Notes:
- Passwords are stored as bcrypt hashes in `password_hash`.
