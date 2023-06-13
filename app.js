const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("http://Server started at 3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

//EXPORTING EXPRESS INSTANCE
module.exports = app;

//AUTHENTICATE WITH JWT TOKEN API
const authenticateToken = async (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "hi", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//REGISTERING A USER API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `
        SELECT * FROM user WHERE username = "${username}";
    `;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const createUserQuery = `
                INSERT INTO user (username, password, name, gender)
                VALUES(
                    "${username}",
                    "${hashedPassword}",
                    "${name}",
                    "${gender}"
                );
            `;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//VALIDATING CREDENTIALS AND GENERATING JWT TOKEN API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
        SELECT * FROM user WHERE username = "${username}";
    `;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isValidPassword = await bcrypt.compare(password, dbUser.password);
    if (isValidPassword === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "hi");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//RETURN LATEST TWEETS OF A USER API (PENDING...)
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
        SELECT user_id as userId FROM user
        WHERE username = "${username}";
    `;
  const getUserId = await db.get(selectUserQuery);

  const getTweetsQuery = `
        SELECT DISTINCT username, tweet, date_time AS dateTime FROM tweet NATURAL JOIN user
        WHERE user_id IN (SELECT following_user_id FROM follower
        WHERE follower_user_id = ${getUserId.userId}) ORDER BY username;
   `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//RETURNS THE NAME OF PEOPLE USER FOLLOWING API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
  const getUserId = await db.get(selectUserQuery);
  const getNamesQuery = `
       SELECT name FROM user
       WHERE user_id IN (SELECT following_user_id FROM follower
        WHERE follower_user_id = ${getUserId.userId})
  `;
  const names = await db.all(getNamesQuery);
  response.send(names);
});

//PEOPLE WHO FOLLOWS USER API
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
  const getUserId = await db.get(selectUserQuery);
  const selectFollowersQuery = `
        SELECT name FROM user WHERE user_id IN (
            SELECT follower_user_id FROM follower WHERE
             following_user_id = ${getUserId.userId}
        )

   `;
  const res = await db.all(selectFollowersQuery);
  response.send(res);
});

//REQUESTING TWEETS API
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
  const getUserId = await db.get(selectUserQuery);

  const selectFollowingQuery = `
        SELECT following_user_id AS followingId FROM follower
        WHERE follower_user_id = ${getUserId.userId};
   `;
  const followingIds = await db.all(selectFollowingQuery);
  const check = followingIds.some(
    (obj) => obj.followingId === parseInt(tweetId)
  );

  if (check) {
    const getTweetQuery = `
      SELECT tweet, date_time AS dateTime FROM tweet
      WHERE tweet_id = ${tweetId};
  `;
    const getLikesQuery = `
        SELECT COUNT(like_id) AS likes FROM like
        WHERE tweet_id = ${tweetId};
  `;
    const getRepliesQuery = `
        SELECT COUNT(reply_id) AS replies FROM reply
        WHERE tweet_id = ${tweetId};
  `;
    const tweet = await db.get(getTweetQuery);
    const likes = await db.get(getLikesQuery);
    const replies = await db.get(getRepliesQuery);

    const resultFunction = (tweet, likes, replies) => {
      return {
        tweet: tweet.tweet,
        likes: likes.likes,
        replies: replies.replies,
        dateTime: tweet.dateTime,
      };
    };

    const resObj = resultFunction(tweet, likes, replies);
    response.send(resObj);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//LIST OF USERNAMES API
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
    const getUserId = await db.get(selectUserQuery);

    //GET FOLLWING ID'S API
    const selectFollowingQuery = `
        SELECT following_user_id AS followingId FROM follower
        WHERE follower_user_id = ${getUserId.userId};
   `;
    const followingIds = await db.all(selectFollowingQuery);
    const check = followingIds.some(
      (obj) => obj.followingId === parseInt(tweetId)
    );

    if (check) {
      const selectUserQuery = `
        SELECT user_id FROM like
        WHERE tweet_id= ${tweetId};
   `;
      const userIdList = await db.all(selectUserQuery);

      const userList = [];
      for (let userId of userIdList) {
        const dbQuery = `
            SELECT username FROM user
            WHERE user_id= ${userId.user_id};
        `;
        const userName = await db.get(dbQuery);
        userList.push(userName.username);
      }

      response.send({ likes: userList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//RETURN THE REPLIES OF A TWEET API
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
    const getUserId = await db.get(selectUserQuery);

    //GET FOLLWING ID'S API
    const selectFollowingQuery = `
        SELECT following_user_id AS followingId FROM follower
        WHERE follower_user_id = ${getUserId.userId};
   `;
    const followingIds = await db.all(selectFollowingQuery);
    const check = followingIds.some(
      (obj) => obj.followingId === parseInt(tweetId)
    );

    if (check) {
      const selectUserQuery = `
        SELECT reply_id FROM reply
        WHERE tweet_id= ${tweetId};
   `;
      const replyIdList = await db.all(selectUserQuery);

      const userList = [];
      for (let replyId of replyIdList) {
        const dbQuery = `
            SELECT name,reply FROM user NATURAL JOIN reply
            WHERE reply.reply_id= ${replyId.reply_id};
        `;
        const namesAndRepliesList = await db.get(dbQuery);
        userList.push(namesAndRepliesList);
      }

      response.send({ replies: userList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//RETURN LIST OF ALL TWEETS OF A USER API
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
  const getUserId = await db.get(selectUserQuery);
  const selectTweetsQuery = `
        SELECT tweet_id FROM tweet
        WHERE user_id = ${getUserId.userId};
  `;
  const tweet_ids = await db.all(selectTweetsQuery);

  const tweetsList = [];
  for (let tweetId of tweet_ids) {
    const getTweetQuery = `
      SELECT tweet, date_time AS dateTime FROM tweet
      WHERE tweet_id = ${tweetId.tweet_id};
  `;
    const getLikesQuery = `
            SELECT COUNT(like_id) AS likes FROM like
            WHERE tweet_id = ${tweetId.tweet_id};
      `;
    const getRepliesQuery = `
            SELECT COUNT(reply_id) AS replies FROM reply
            WHERE tweet_id = ${tweetId.tweet_id};
      `;
    const tweet = await db.get(getTweetQuery);
    const likes = await db.get(getLikesQuery);
    const replies = await db.get(getRepliesQuery);

    const resultFunction = (tweet, likes, replies) => {
      return {
        tweet: tweet.tweet,
        likes: likes.likes,
        replies: replies.replies,
        dateTime: tweet.dateTime,
      };
    };

    const resObj = resultFunction(tweet, likes, replies);
    tweetsList.push(resObj);
  }

  response.send(tweetsList);
});

// POST A TWEET API
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
  const getUserId = await db.get(selectUserQuery);
  const dateTime = new Date();
  const newDate = `${dateTime.getFullYear()}-${dateTime.getMonth()}-${dateTime.getDate()} ${dateTime.getHours()}:${dateTime.getMinutes()}:${dateTime.getSeconds()}`;
  const createTweetQuery = `
        INSERT INTO tweet(tweet, user_id, date_time)
        VALUES("${tweet}",
        ${getUserId.userId},
        "${newDate}"
        );
  `;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//DELETING A TWEET API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const selectUserQuery = `
            SELECT user_id as userId FROM user
            WHERE username = "${username}";
        `;
    const getUserId = await db.get(selectUserQuery);
    const checkTweetQuery = `
     SELECT user_id FROM tweet 
     WHERE tweet_id = ${tweetId};
  `;
    const userIdFromTable = await db.get(checkTweetQuery);

    if (userIdFromTable.user_id === getUserId.userId) {
      const deleteTweetQuery = `
            DELETE FROM tweet 
            WHERE tweet_id = ${tweetId};
        `;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
