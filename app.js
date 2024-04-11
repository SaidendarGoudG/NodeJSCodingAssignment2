const express = require('express')
const app = express()
app.use(express.json())
module.exports = app

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB error: ${e.message}`)
    process.exit(1)
  }
}
initializeDBAndServer()

//Authenticate Token MiddleWare
const authenticateToken = (request, response, next) => {
  let jwtToken = null
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'GSGOUD', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        console.log(payload)
        next()
      }
    })
  }
}

//TWEET ACCESS VERIFICATION

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `
    SELECT *
    FROM tweet INNER JOIN follower 
    ON tweet.user_id=follower.following_user_id
    WHERE tweet.tweet_id='${tweetId}' AND follower_user_id='${userId}';`
  const tweet = await db.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//API 1
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(request.body.password, 10)

  const selectUserQuery = `SELECT * FROM user WHERE username='${username}';`
  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const createUserQuery = `
            INSERT INTO
            user (username,password,name,gender)
            VALUES
            (
                '${username}',
                '${hashedPassword}',
                '${name}',
                '${gender}'
            );`

      const dbResponse = await db.run(createUserQuery)
      // console.log(dbResponse)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API 2
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}';`

  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched) {
      const payload = {username: username, userId: dbUser.user_id}
      //console.log(payload)
      const jwtToken = jwt.sign(payload, 'GSGOUD')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//Getting User Following People Id's
const getUserFollowingPeopleIds = async username => {
  const getTheFollowingPeopleQuery = `
  SELECT following_user_id
  FROM follower
  INNER JOIN user ON user.user_id=follower.follower_user_id
  WHERE user.username='${username}';`

  const followingPeople = await db.all(getTheFollowingPeopleQuery)
  const arrayOfIds = followingPeople.map(eachUser => eachUser.following_user_id)
  return arrayOfIds
}

//API 3
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const followingPeopleIds = await getUserFollowingPeopleIds(username)

  const getTweetsQuery = `
  SELECT username,tweet,date_time AS dateTime
  FROM user
  INNER JOIN tweet ON user.user_id=tweet.user_id
  WHERE user.user_id IN (${followingPeopleIds})
  ORDER BY date_time DESC
  LIMIT 4;`

  const latestTweets = await db.all(getTweetsQuery)
  response.send(latestTweets)
})

//API 4
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username, userId} = request
  //console.log(userId)
  const getFollowingUserQuery = `
  SELECT name
  FROM follower
  INNER JOIN user ON user.user_id=follower.following_user_id
  WHERE follower_user_id='${userId}';`

  const getNamesOfUserFollowing = await db.all(getFollowingUserQuery)
  response.send(getNamesOfUserFollowing)
})

//API 5
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username, userId} = request
  const getFollowersQuery = `
  SELECT DISTINCT name 
  FROM follower
  INNER JOIN user ON user.user_id=follower.follower_user_id
  WHERE following_user_id='${userId}';`

  const followers = await db.all(getFollowersQuery)
  response.send(followers)
})

//API 6
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `SELECT tweet,
    (SELECT COUNT(*) FROM like WHERE tweet_id='${tweetId}') AS likes,
    (SELECT COUNT(*) FROM reply WHERE tweet_id='${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet 
    WHERE tweet.tweet_id='${tweetId}';`

    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  },
)

//API-7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `
    SELECT username 
    FROM user INNER JOIN like ON user.user_id=like.user_id
    WHERE tweet_id='${tweetId}';`

    const likedUsers = await db.all(getLikesQuery)
    const usersArray = likedUsers.map(eachUser => eachUser.username)
    response.send({likes: usersArray})
  },
)

//API-8
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getRepliedQuery = `
    SELECT name, reply 
    FROM user INNER JOIN reply ON user.user_id=reply.user_id
    WHERE tweet_id='${tweetId}';`

    const repliedUsers = await db.all(getRepliedQuery)
    response.send({replies: repliedUsers})
  },
)

//API-9
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request
  const getTweetsQuery = `SELECT tweet,
    COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time AS dateTime
    FROM tweet LEFT JOIN reply ON tweet.tweet_id=reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id=like.tweet_id
    WHERE tweet.user_id='${userId}'
    GROUP BY tweet.tweet_id;`

  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})

//API-10
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createTweetQuery = `
    INSERT INTO tweet(tweet, user_id, date_time)
    VALUES('${tweet}', '${userId}', '${dateTime}')`

  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

//API-11
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const getTheTweetQuery = `
    SELECT * 
    FROM tweet 
    WHERE user_id='${userId}' AND tweet_id='${tweetId}';`
    const tweet = await db.get(getTheTweetQuery)
    console.log(tweet)
    if (tweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id='${tweetId}';`
      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    }
  },
)
