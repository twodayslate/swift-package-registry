'use strict'
module.exports = (sequelize, DataTypes) => {
  const Package = sequelize.define('Package', {
    github_id: DataTypes.BIGINT, // using this so we don't have to search in info

    info: DataTypes.JSONB,
    latest_release: DataTypes.JSONB,
    topics: DataTypes.ARRAY(DataTypes.STRING),
    processing: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    error: DataTypes.TEXT,
    tools_version: DataTypes.STRING,
    description: DataTypes.JSONB, // swift package describe
    dependencies: DataTypes.JSONB, // swift package show-dependencies
    dump: DataTypes.JSONB, // swift package dump-package
    readme: DataTypes.TEXT,

    is_installed: { // if the owner has this repository installed
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    // OLD/deprecated

    name: DataTypes.STRING,
    full_name: DataTypes.STRING,
    readme_raw: DataTypes.TEXT,
    readme_html: DataTypes.TEXT,

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
  }, {})
  Package.associate = function (models) {
    // associations can be defined here
  }
  return Package
}
