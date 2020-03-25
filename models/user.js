'use strict';
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    uuid: DataTypes.STRING,
    github_id: DataTypes.BIGINT,
    github_login: DataTypes.STRING,
    passport_github2_raw: DataTypes.TEXT,
    accessToken: DataTypes.STRING,
    github_raw: DataTypes.TEXT,
    isAdmin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    isMod: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    createdAt: {
        type: DataTypes.DATE,
        defaultValue: sequelize.NOW
        // This way, the current date/time will be used to populate this column (at the moment of insertion)
      },
    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: sequelize.NOW
        // This way, the current date/time will be used to populate this column (at the moment of insertion)
      }
  }, {});
  User.associate = function(models) {
    // associations can be defined here
  };
  return User;
};