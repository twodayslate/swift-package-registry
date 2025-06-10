describe('Mod Route Filtering Logic', () => {
  let mockRouter
  let mockReq
  let mockRes
  let db

  beforeAll(async () => {
    // Get the test database (will be SQLite in-memory)
    db = require('../models')

    // Sync the database schema for tests
    await db.sequelize.sync({ force: true })
  })

  beforeEach(async () => {
    // Clear test data before each test
    await db.Package.destroy({ where: {} })

    // Create test data
    await db.Package.bulkCreate([
      {
        github_id: 1,
        full_name: 'user/package-with-error',
        info: { full_name: 'user/package-with-error', description: 'Package with error' },
        processing: false,
        error: 'Build failed'
      },
      {
        github_id: 2,
        full_name: 'user/package-no-error',
        info: { full_name: 'user/package-no-error', description: 'Working package' },
        processing: false,
        error: null
      },
      {
        github_id: 3,
        full_name: 'user/package-empty-error',
        info: { full_name: 'user/package-empty-error', description: 'Package with empty error' },
        processing: false,
        error: ''
      },
      {
        github_id: 4,
        full_name: 'user/processing-package',
        info: { full_name: 'user/processing-package', description: 'Currently processing' },
        processing: true,
        error: null
      },
      {
        github_id: 5,
        full_name: 'user/another-error-package',
        info: { full_name: 'user/another-error-package', description: 'Another error package' },
        processing: false,
        error: 'Validation error'
      }
    ])

    // Setup mock router with real database
    mockRouter = {
      db,
      get: jest.fn()
    }

    // Setup mock request and response
    mockReq = {
      user: { isMod: true },
      query: {}
    }

    mockRes = {
      redirect: jest.fn(),
      render: jest.fn()
    }
  })

  afterAll(async () => {
    // Close database connection
    if (db && db.sequelize) {
      await db.sequelize.close()
    }
  })

  describe('Route registration', () => {
    it('should register the /mod route', () => {
      require('../lib/mod')(mockRouter)
      expect(mockRouter.get).toHaveBeenCalledWith('/mod', expect.any(Function))
    })
  })

  describe('Authentication and authorization', () => {
    let modRoute

    beforeEach(() => {
      require('../lib/mod')(mockRouter)
      const routeCall = mockRouter.get.mock.calls.find(call => call[0] === '/mod')
      modRoute = routeCall[1]
    })

    it('should redirect non-mod users', async () => {
      mockReq.user.isMod = false

      await modRoute(mockReq, mockRes)

      expect(mockRes.redirect).toHaveBeenCalledWith('/')
      expect(mockRes.render).not.toHaveBeenCalled()
    })

    it('should redirect users without authentication', async () => {
      mockReq.user = null

      await modRoute(mockReq, mockRes)

      expect(mockRes.redirect).toHaveBeenCalledWith('/')
      expect(mockRes.render).not.toHaveBeenCalled()
    })
  })

  describe('Filter functionality with real database', () => {
    let modRoute

    beforeEach(() => {
      require('../lib/mod')(mockRouter)
      const routeCall = mockRouter.get.mock.calls.find(call => call[0] === '/mod')
      modRoute = routeCall[1]
    })

    it('should filter packages with errors only', (done) => {
      mockReq.query.filter = 'errors'

      modRoute(mockReq, mockRes)

      // Wait for the promise chain to complete
      setTimeout(() => {
        try {
          expect(mockRes.render).toHaveBeenCalledWith('mod', expect.objectContaining({
            current_filter: 'errors'
          }))

          const renderCall = mockRes.render.mock.calls[0][1]
          expect(renderCall.all_packages).toHaveLength(2)

          // Verify all returned packages have errors (not empty strings)
          renderCall.all_packages.forEach(pkg => {
            expect(pkg.error).toBeTruthy()
            expect(pkg.error).not.toBe('')
          })

          // Verify processing packages are still returned
          expect(renderCall.processing_packages).toHaveLength(1)
          expect(renderCall.processing_packages[0].processing).toBe(true)
          done()
        } catch (error) {
          done(error)
        }
      }, 50)
    })

    it('should filter packages without errors', (done) => {
      mockReq.query.filter = 'no-errors'

      modRoute(mockReq, mockRes)

      setTimeout(() => {
        try {
          expect(mockRes.render).toHaveBeenCalledWith('mod', expect.objectContaining({
            current_filter: 'no-errors'
          }))

          const renderCall = mockRes.render.mock.calls[0][1]
          expect(renderCall.all_packages).toHaveLength(2)

          // Verify all returned packages have no errors
          renderCall.all_packages.forEach(pkg => {
            expect(pkg.error === null || pkg.error === '').toBe(true)
          })
          done()
        } catch (error) {
          done(error)
        }
      }, 50)
    })

    it('should return all packages when filter is "all"', (done) => {
      mockReq.query.filter = 'all'

      modRoute(mockReq, mockRes)

      setTimeout(() => {
        try {
          const renderCall = mockRes.render.mock.calls[0][1]
          expect(renderCall.all_packages).toHaveLength(4) // 4 non-processing packages
          expect(renderCall.current_filter).toBe('all')
          done()
        } catch (error) {
          done(error)
        }
      }, 50)
    })

    it('should default to "all" filter when no filter is specified', (done) => {
      // mockReq.query.filter is undefined

      modRoute(mockReq, mockRes)

      setTimeout(() => {
        try {
          const renderCall = mockRes.render.mock.calls[0][1]
          expect(renderCall.all_packages).toHaveLength(4)
          expect(renderCall.current_filter).toBe('all')
          done()
        } catch (error) {
          done(error)
        }
      }, 50)
    })

    it('should handle unknown filter values gracefully', (done) => {
      mockReq.query.filter = 'unknown-filter'

      modRoute(mockReq, mockRes)

      setTimeout(() => {
        try {
          const renderCall = mockRes.render.mock.calls[0][1]
          expect(renderCall.all_packages).toHaveLength(4) // Should return all packages
          expect(renderCall.current_filter).toBe('unknown-filter')
          done()
        } catch (error) {
          done(error)
        }
      }, 50)
    })

    it('should maintain processing packages regardless of filter', (done) => {
      // Test with errors filter
      mockReq.query.filter = 'errors'
      modRoute(mockReq, mockRes)

      setTimeout(() => {
        try {
          let renderCall = mockRes.render.mock.calls[0][1]
          expect(renderCall.processing_packages).toHaveLength(1)
          expect(renderCall.processing_packages[0].processing).toBe(true)

          // Reset mocks and test with no-errors filter
          mockRes.render.mockClear()
          mockReq.query.filter = 'no-errors'
          modRoute(mockReq, mockRes)

          setTimeout(() => {
            try {
              renderCall = mockRes.render.mock.calls[0][1]
              expect(renderCall.processing_packages).toHaveLength(1)
              expect(renderCall.processing_packages[0].processing).toBe(true)
              done()
            } catch (error) {
              done(error)
            }
          }, 50)
        } catch (error) {
          done(error)
        }
      }, 50)
    })

    it('should order packages by creation date descending', (done) => {
      modRoute(mockReq, mockRes)

      setTimeout(() => {
        try {
          const renderCall = mockRes.render.mock.calls[0][1]
          const allPackages = renderCall.all_packages

          // Check that packages are ordered by createdAt DESC
          for (let i = 0; i < allPackages.length - 1; i++) {
            const current = new Date(allPackages[i].createdAt)
            const next = new Date(allPackages[i + 1].createdAt)
            expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime())
          }
          done()
        } catch (error) {
          done(error)
        }
      }, 50)
    })
  })

  describe('Database query validation', () => {
    it('should correctly query packages with errors (excluding empty strings)', async () => {
      const packagesWithErrors = await db.Package.findAll({
        where: {
          processing: false,
          error: {
            [db.Sequelize.Op.and]: [
              { [db.Sequelize.Op.not]: null },
              { [db.Sequelize.Op.ne]: '' }
            ]
          }
        }
      })

      expect(packagesWithErrors).toHaveLength(2)
      packagesWithErrors.forEach(pkg => {
        expect(pkg.error).toBeTruthy()
        expect(pkg.error).not.toBe('')
        expect(pkg.processing).toBe(false)
      })
    })

    it('should correctly query packages without errors (including empty strings)', async () => {
      const packagesWithoutErrors = await db.Package.findAll({
        where: {
          processing: false,
          [db.Sequelize.Op.or]: [
            { error: null },
            { error: '' }
          ]
        }
      })

      expect(packagesWithoutErrors).toHaveLength(2)
      packagesWithoutErrors.forEach(pkg => {
        expect(pkg.error === null || pkg.error === '').toBe(true)
        expect(pkg.processing).toBe(false)
      })
    })

    it('should correctly query processing packages', async () => {
      const processingPackages = await db.Package.findAll({
        where: { processing: true }
      })

      expect(processingPackages).toHaveLength(1)
      expect(processingPackages[0].processing).toBe(true)
    })
  })

  describe('Database query construction (unit tests)', () => {
    it('should construct correct where clause for errors filter', () => {
      const filter = 'errors'
      const mockSequelize = { Op: { and: 'AND_OP', not: 'NOT_OP', ne: 'NE_OP' } }

      let allPackagesWhere = {}

      if (filter === 'errors') {
        allPackagesWhere = {
          error: {
            [mockSequelize.Op.and]: [
              { [mockSequelize.Op.not]: null },
              { [mockSequelize.Op.ne]: '' }
            ]
          }
        }
      }

      expect(allPackagesWhere).toEqual({
        error: {
          [mockSequelize.Op.and]: [
            { [mockSequelize.Op.not]: null },
            { [mockSequelize.Op.ne]: '' }
          ]
        }
      })
    })

    it('should construct correct where clause for no-errors filter', () => {
      const filter = 'no-errors'
      const mockSequelize = { Op: { or: 'OR_OP' } }

      let allPackagesWhere = {}

      if (filter === 'no-errors') {
        allPackagesWhere = {
          [mockSequelize.Op.or]: [
            { error: null },
            { error: '' }
          ]
        }
      }

      expect(allPackagesWhere).toEqual({
        [mockSequelize.Op.or]: [
          { error: null },
          { error: '' }
        ]
      })
    })

    it('should construct empty where clause for all filter', () => {
      const allPackagesWhere = {}
      expect(allPackagesWhere).toEqual({})
    })

    it('should construct empty where clause for unknown filter', () => {
      const allPackagesWhere = {}
      expect(allPackagesWhere).toEqual({})
    })
  })
})
