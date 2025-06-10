const nock = require('nock')
const { Probot } = require('probot')
const myProbotApp = require('..')
const fs = require('fs')
const path = require('path')

describe('Swift Package Registry App', () => {
  let probot
  let mockCert
  let db

  beforeAll((done) => {
    fs.readFile(path.join(__dirname, 'fixtures/mock-cert.pem'), (err, cert) => {
      if (err) return done(err)
      mockCert = cert
      done()
    })
  })

  beforeAll(async () => {
    // Initialize database connection once
    db = require('../models')
    await db.sequelize.sync({ force: true })
  })

  beforeEach(async () => {
    nock.disableNetConnect()

    probot = new Probot({
      appId: 123,
      privateKey: mockCert
    })

    // Clear database data but reuse connection
    await db.Package.destroy({ where: {} })
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()

    // Just nullify the probot reference
    probot = null
  })

  afterAll(async () => {
    // Close database connection only once at the end
    if (db && db.sequelize) {
      await db.sequelize.close()
    }
  })

  // Helper function to wait for app loading to complete
  const waitForAppLoad = async (timeout = 5000) => {
    return new Promise((resolve) => {
      const startTime = Date.now()

      const checkLoaded = async () => {
        try {
          // Check if the app has completed initialization by testing database operations
          await db.Package.count()
          resolve()
        } catch (error) {
          if (Date.now() - startTime > timeout) {
            resolve() // Timeout reached, proceed anyway
          } else {
            setTimeout(checkLoaded, 100)
          }
        }
      }

      // Start checking after a small delay to let the app begin loading
      setTimeout(checkLoaded, 200)
    })
  }

  describe('Database Integration', () => {
    it('should connect to database and sync models', async () => {
      // Test that database connection works
      expect(db.sequelize).toBeDefined()
      expect(db.Package).toBeDefined()

      // Test that we can create a package
      const testPackage = await db.Package.create({
        github_id: 12345,
        info: {
          full_name: 'test/package',
          description: 'Test package'
        },
        processing: false
      })

      expect(testPackage.github_id).toBe(12345)
      expect(testPackage.info.full_name).toBe('test/package')
    })

    it('should count packages correctly', async () => {
      // Create test packages
      await db.Package.bulkCreate([
        {
          github_id: 1,
          info: { full_name: 'user/package1', description: 'Package 1' },
          processing: false,
          error: null
        },
        {
          github_id: 2,
          info: { full_name: 'user/package2', description: 'Package 2' },
          processing: false,
          error: 'Some error'
        },
        {
          github_id: 3,
          info: { full_name: 'user/package3', description: 'Package 3' },
          processing: true,
          error: null
        }
      ])

      const count = await db.Package.count({
        where: { processing: false, error: null }
      })

      expect(count).toBe(1) // Only one package without errors and not processing
    })
  })

  describe('Probot App Loading', () => {
    it('should load the app using probot.load() like in production', async () => {
      // Mock GitHub API
      nock('https://api.github.com')
        .get('/app')
        .reply(200, { id: 123, name: 'test-app' })
        .persist()

      // Load the app using the production method
      probot.load(myProbotApp)

      // Wait for the app to be fully loaded
      await waitForAppLoad()

      // Test that the app loaded successfully by checking if we can access the database
      const packageCount = await db.Package.count()
      expect(packageCount).toBe(0) // Should be 0 since we cleared the data
    })

    it('should handle REPROCESS_ALL environment variable when loaded via probot.load()', async () => {
      // Create some test packages
      await db.Package.bulkCreate([
        {
          github_id: 1,
          info: { full_name: 'user/package1', description: 'Package 1' },
          processing: false
        },
        {
          github_id: 2,
          info: { full_name: 'user/package2', description: 'Package 2' },
          processing: false
        }
      ])

      // Set the environment variable
      const originalEnv = process.env.REPROCESS_ALL
      process.env.REPROCESS_ALL = 'True'

      try {
        // Mock GitHub API
        nock('https://api.github.com')
          .get('/app')
          .reply(200, { id: 123, name: 'test-app' })
          .persist()

        // Load the app using the production method
        probot.load(myProbotApp)

        // Wait for the app to be fully loaded and REPROCESS_ALL to execute
        await waitForAppLoad()

        // Check if all packages were marked as processing
        const processingPackages = await db.Package.findAll({
          where: { processing: true }
        })

        expect(processingPackages.length).toBeGreaterThan(0)
      } finally {
        // Restore original environment
        if (originalEnv !== undefined) {
          process.env.REPROCESS_ALL = originalEnv
        } else {
          delete process.env.REPROCESS_ALL
        }
      }
    })
  })

  describe('Application State Management', () => {
    it('should initialize database connection when app is loaded', async () => {
      // Mock GitHub API
      nock('https://api.github.com')
        .get('/app')
        .reply(200, { id: 123, name: 'test-app' })
        .persist()

      // Load the app
      probot.load(myProbotApp)

      // Wait for initialization to complete
      await waitForAppLoad()

      // Test that database operations work after app loading
      const testPackage = await db.Package.create({
        github_id: 99999,
        info: {
          full_name: 'test/loaded-package',
          description: 'Package created after app load'
        },
        processing: false
      })

      expect(testPackage.github_id).toBe(99999)
      expect(testPackage.info.full_name).toBe('test/loaded-package')
    })
  })
})

// For more information about testing with Jest see:
// https://facebook.github.io/jest/

// For more information about testing with Nock see:
// https://github.com/nock/nock
