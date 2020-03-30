// main.js
const { Probot } = require('probot')
const app = require('./index.js')

// pass a probot app as a function
Probot.run(app)
