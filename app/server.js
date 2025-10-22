const pg = require("pg");
const express = require("express");
const app = express();

const port = 3000;
const hostname = "localhost";

const env = require("../env.json");
const Pool = pg.Pool;
const pool = new Pool(env);
pool.connect().then(function () {
  console.log(`Connected to database ${env.database}`);
});

app.use(express.static("public"));
app.use(express.json()); 

//adding basic post and get methods to insert music and search music by genre
app.post('/add', async (req, res) => {
  let { title, genre } = req.body;

  try {
    await pool.query(
      `INSERT INTO music(title, genre) VALUES($1, $2)`,
      [title, genre]
    );
    res.status(200).send();
  } catch (error) {
    console.log("Error inserting music:", error);
    res.status(500).send();
  }
});


app.get('/search', async (req, res) => {
  let genre = req.query.genre;
  let query, params;

  if (!genre) {
    query = 'SELECT * FROM music';
    params = [];
  } else {
    query = 'SELECT * FROM music WHERE genre = $1';
    params = [genre];
  }

  try {
    let result = await pool.query(query, params);
    res.status(200).json({ rows: result.rows });
  } catch (error) {
    console.log("Error searching music:", error);
    res.status(500).send();
  }
});


app.listen(port, hostname, () => {
  console.log(`Listening at: http://${hostname}:${port}`);
});
