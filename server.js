require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 8080;

// --- GOOGLE API SETUP ---
const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const MASTER_SHEET = 'Master Inventory';
const INVENTORY_SHEET = 'Inventory';
const ORDERS_SHEET = 'Orders';

/**
 * Helper: Encode email to Base64 (Gmail API Requirement)
 */
function createEncodedEmail(to, subject, htmlMessage) {
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const email = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        htmlMessage
    ].join('\r\n');
    return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 1. GET INVENTORY & PICKUP DETAILS
 */
app.get('/inventory', async (req, res) => {
    try {
        const [masterRes, stockRes, pickupRes] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${MASTER_SHEET}!A2:E` }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${INVENTORY_SHEET}!A2:B` }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${INVENTORY_SHEET}!F2:F5` })
        ]);

        const masterRows = masterRes.data.values || [];
        const stockRows = stockRes.data.values || [];
        const pickupRows = pickupRes.data.values || [];

        // Map Master Details (Price, Category, Image)
        const masterDetails = {};
        masterRows.forEach(row => {
            const name = row[0]?.trim();
            if (name) {
                masterDetails[name] = {
                    price: Number(row[1]) || 0,
                    category: row[2] || "",
                    image: row[3] || "",
                    description: row[4] || "" // Added Column E (Index 4)
                };
            }
        });

        // Build Final Inventory List
        const inventory = [];
        stockRows.forEach(row => {
            const itemName = row[0]?.trim();
            if (itemName && masterDetails[itemName]) {
                inventory.push({
                    item: itemName,
                    stock: Number(row[1]) || 0,
                    ...masterDetails[itemName]
                });
            }
        });

        // Build Pickup Object (Plain text from F2, F3, F4)
        const pickup = {
            date: pickupRows[0] ? pickupRows[0][0] : "",
            hours: pickupRows[1] ? pickupRows[1][0] : "",
            afterHours: pickupRows[2] ? pickupRows[2][0] : "",
            template: pickupRows[3] ? pickupRows[3][0] : ""
        };

        // Send combined object
        res.json({ inventory, pickup });

    } catch (err) {
        console.error('Inventory Sync Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

/**
 * 2. PROCESS ORDER
 */
app.post('/order', async (req, res) => {
    try {
        const { firstName, lastName, email, phone, items, slicing, payment, notes } = req.body;

        // --- GENERATE TIMESTAMP ORDER ID (MMDDHHMMSS) ---
        const now = new Date();
        const orderNumber = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

        // --- FETCH STOCK FOR UPDATES ---
        const invRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${INVENTORY_SHEET}!A2:B`
        });
        const invData = invRes.data.values || [];

        let grandTotal = 0;
        const breadQuantities = new Array(invData.length).fill("");

        // Update Inventory in Sheets & Calculate Total
        for (const orderedItem of items) {
            const idx = invData.findIndex(r => r[0] === orderedItem.item);
            if (idx !== -1) {
                breadQuantities[idx] = orderedItem.quantity;
                grandTotal += (orderedItem.price * orderedItem.quantity);

                const newStock = Number(invData[idx][1]) - orderedItem.quantity;
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${INVENTORY_SHEET}!B${idx + 2}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[newStock]] }
                });
            }
        }

        // --- PREPARE EMAIL FROM TEMPLATE FILE ---
        let emailStatus = "SENT";
        try {
            const templatePath = path.join(__dirname, 'emailTemplate.html');
            let htmlContent = fs.readFileSync(templatePath, 'utf8');

            // Replace Placeholders
            htmlContent = htmlContent
                .replace(/{{firstName}}/g, firstName)
                .replace(/{{orderNumber}}/g, orderNumber)
                .replace(/{{total}}/g, grandTotal.toFixed(2))
                .replace(/{{payment}}/g, payment)
                .replace(/{{slicing}}/g, slicing)
                .replace(/{{notes}}/g, notes || "None");

            const encodedMail = createEncodedEmail(email, `🍞 Order Confirmation: #${orderNumber}`, htmlContent);

            await gmail.users.messages.send({
                userId: 'me',
                requestBody: { raw: encodedMail }
            });
        } catch (mailErr) {
            console.error('Email Failed:', mailErr.message);
            emailStatus = "FAILED";
        }

        // --- LOG ORDER TO SPREADSHEET ---
        const orderRow = [
            orderNumber,
            new Date().toLocaleString(),
            emailStatus,
            firstName,
            lastName,
            phone,
            email,
            payment,
            "No", // Placeholder for "Paid" column
            grandTotal,
            slicing,
            notes,
            ...breadQuantities
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ORDERS_SHEET}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [orderRow] }
        });

        res.json({ success: true, orderNumber });

    } catch (err) {
        console.error('Order Error:', err.message);
        res.status(500).json({ error: 'Server failed to process order' });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Bakery server listening on port ${port}`);
});
