# Database migration: users table

This folder contains a small SQL query's to create a `users` table used for authentication.

Run (from a shell with psql).

```powershell
psql -U postgres -d garden -f app/db/create_users.sql
```

Notes:
- Passwords are stored as bcrypt hashes in `password_hash`.