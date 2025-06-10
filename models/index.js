'use strict'

const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const basename = path.basename(__filename)
const db = {}

// Use different database configurations based on environment
let sequelize
if (process.env.NODE_ENV === 'test') {
  // Use in-memory SQLite for tests
  sequelize = new Sequelize({
    dialect: 'sqlite',
    logging: false, // Disable SQL logging in tests
    storage: ':memory:'
  })
} else {
  // Use PostgreSQL for development/production
  sequelize = new Sequelize(process.env.POSTGRESQL_SERVER || 'postgres://localhost:5432/spr')
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js')
  })
  .forEach(file => {
    // const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes)
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes)
    db[model.name] = model
  })

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db)
  }
})

db.sequelize = sequelize
db.Sequelize = Sequelize

module.exports = db
