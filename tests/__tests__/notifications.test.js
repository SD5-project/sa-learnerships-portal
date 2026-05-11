const request = require('supertest');
const app = require('./app'); // Your Express app
const { db } = require('./firebaseAdmin');
const nodemailer = require('nodemailer');

// Mocking dependencies
jest.mock('./firebaseAdmin');
jest.mock('nodemailer');

describe('PATCH /api/applicants/:applicationID/status', () => {
    
    test('should update status successfully and send email', async () => {
        // Mock Firestore data
        db.collection().doc().get.mockResolvedValue({
            exists: true,
            data: () => ({ listingID: 'list123', applicantID: 'user456' })
        });

        // 2. Mock Nodemailer success
        const sendMailMock = jest.fn().mockResolvedValueOnce('sent');
        nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock, verify: jest.fn() });

        const response = await request(app)
            .patch('/api/applicants/app789/status')
            .set('Authorization', 'Bearer mock-token') // You'll need to mock your verifyToken middleware
            .send({ status: 'shortlisted' });

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('Status updated');
        expect(sendMailMock).toHaveBeenCalled();
    });

    test('should return 400 for invalid status', async () => {
        const response = await request(app)
            .patch('/api/applicants/app789/status')
            .send({ status: 'invalid-status-name' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid status');
    });
});