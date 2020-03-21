'use strict';
module.exports = (sequelize, DataTypes) => {
  const Package = sequelize.define('Package', {
    name: DataTypes.STRING,
    full_name: DataTypes.STRING,
    repo: DataTypes.STRING,
    swift_tool_version: DataTypes.STRING,
    swift_describe_raw: DataTypes.TEXT,
    swift_dependencies_raw: DataTypes.TEXT,
    readme_raw: DataTypes.TEXT,
    readme_html: DataTypes.TEXT,

    github_id: DataTypes.BIGINT,
    github_default_branch: DataTypes.STRING,
    
    github_description: DataTypes.STRING,
    github_html_url: DataTypes.STRING,
    github_clone_url: DataTypes.STRING,

    github_release: DataTypes.STRING,
    github_release_tag: DataTypes.STRING,
    github_release_name: DataTypes.STRING,
    github_release_body: DataTypes.TEXT,
    github_stars: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    processing_error: DataTypes.STRING,
    processing: DataTypes.BOOLEAN,
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
  Package.associate = function(models) {
    // associations can be defined here
  };
  return Package;
};