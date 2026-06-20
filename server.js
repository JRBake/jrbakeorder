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
const recentOrdersCache = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of recentOrdersCache.entries()) {
        if (now - timestamp > 60000) { // Clear anything older than 1 minute
            recentOrdersCache.delete(key);
        }
    }
}, 300000);

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
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${INVENTORY_SHEET}!F2:F6` })
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

        const openStatusString = pickupRows[4] ? pickupRows[4][0] : "No";
        const isOpen = openStatusString.trim().toLowerCase() === "yes";

        // Send combined object
        res.json({ inventory, pickup, isOpen });

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

        // 👇 NEW: CREATE A UNIQUE FINGERPRINT FOR THIS EXACT TRANSACTION
        // Calculates a mini summary total to ensure unique identity
        const itemFingerprint = items.map(i => `${i.item}-${i.quantity}`).join('|');
        const orderFingerprint = `${email.toLowerCase().trim()}_${firstName.trim()}_${itemFingerprint}`;

        // 👇 NEW: CHECK IF TRANSACTION WAS ALREADY PROCESSED IN THE LAST 30 SECONDS
        if (recentOrdersCache.has(orderFingerprint)) {
            const cachedData = recentOrdersCache.get(orderFingerprint);
            console.log(`[DEDUPLICATION] Blocked duplicate retry for: ${orderFingerprint}`);

            // If it's currently processing or finished, return a clean successful mock response
            return res.json({
                success: true,
                orderNumber: cachedData.orderNumber || "DUPLICATE_REJECTED",
                isDuplicate: true
            });
        }

        // Reserve this fingerprint in cache immediately with a temporary placeholder
        recentOrdersCache.set(orderFingerprint, { timestamp: Date.now(), orderNumber: null });

        // --- GENERATE TIMESTAMP ORDER ID (MMDDHHMMSS) ---
        const now = new Date();
        const orderNumber = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

        // Save the real generated order number to our cache row so retries can read it if needed
        recentOrdersCache.set(orderFingerprint, { timestamp: Date.now(), orderNumber: orderNumber });

        // --- FETCH STOCK FOR UPDATES ---
        const [invRes, pickupRes] = await Promise.all([
    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${INVENTORY_SHEET}!A2:B`
    }),
    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${INVENTORY_SHEET}!F2:F4`
    })
]);

const invData = invRes.data.values || [];
const pickupRows = pickupRes.data.values || [];

// Extract the plain text strings safely
const pickupDateText = pickupRows[0] ? pickupRows[0][0] : "To Be Scheduled";
const pickupHoursText = pickupRows[1] ? pickupRows[1][0] : "";
const pickupAfterHoursText = pickupRows[2] ? pickupRows[2][0] : "";

// ==========================================================
        // NEW STEP 1: VALIDATE INVENTORY BEFORE CHANGING ANYTHING
        // ==========================================================
        const stockShortages = [];

        for (const orderedItem of items) {
            const idx = invData.findIndex(r => r[0] === orderedItem.item);
            if (idx !== -1) {
                const currentStock = Number(invData[idx][1]);
                // If they asked for more than we have, log the shortage
                if (orderedItem.quantity > currentStock) {
                    stockShortages.push({
                        item: orderedItem.item,
                        requested: orderedItem.quantity,
                        available: currentStock
                    });
                }
            }
        }

        // If ANY shortages were found, stop completely and tell the frontend
        if (stockShortages.length > 0) {
            return res.status(409).json({
                error: "STOCK_SHORTAGE",
                shortages: stockShortages
            });
        }

        // ==========================================================
        // STEP 2: IF WE REACH THIS POINT, STOCK IS SAFE. PROCEED.
        // ==========================================================
        let grandTotal = 0;
        const breadQuantities = new Array(invData.length).fill("");
        let receiptRowsHtml = ""; // 1. Create a variable to hold our rows

        // Update Inventory in Sheets & Calculate Total
        for (const orderedItem of items) {
            const idx = invData.findIndex(r => r[0] === orderedItem.item);
            if (idx !== -1) {
                breadQuantities[idx] = orderedItem.quantity;

                const itemTotal = orderedItem.price * orderedItem.quantity;
                grandTotal += itemTotal;

                // 2. Build the HTML row for this specific item
                receiptRowsHtml += `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 8px;">${orderedItem.item}</td>
                        <td style="padding: 8px; text-align: center;">${orderedItem.quantity}</td>
                        <td style="padding: 8px; text-align: right;">$${orderedItem.price.toFixed(2)}</td>
                        <td style="padding: 8px; text-align: right;">$${itemTotal.toFixed(2)}</td>
                    </tr>
                `;

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
                .replace(/{{itemizedReceipt}}/g, receiptRowsHtml)
                .replace(/{{total}}/g, grandTotal.toFixed(2))
                .replace(/{{pickupDate}}/g, pickupDateText)
                .replace(/{{pickupHours}}/g, pickupHoursText)
                .replace(/{{pickupAfterHours}}/g, pickupAfterHoursText)
                .replace(/{{payment}}/g, payment)
                .replace(/{{slicing}}/g, slicing)
                .replace(/{{notes}}/g, notes || "None");

            const encodedMail = createEncodedEmail(email, `🍞 Order Confirmation: #${orderNumber}`, htmlContent);

            gmail.users.messages.send({
                userId: 'me',
                requestBody: { raw: encodedMail }
            }).catch(mailErr => console.error('[BACKGROUND EMAIL ERROR]:', mailErr.message));

        } catch (templateErr) {
            console.error('[TEMPLATE OR EMAIL GEN ERROR]:', templateErr.message);
            emailStatus = "FAILED_TO_SEND";
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

        sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ORDERS_SHEET}!A:A`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [orderRow] }
        }).catch(err => console.error("BACKGROUND SHEETS ERROR:", err));

        res.json({ success: true, orderNumber });

    } catch (err) {
        console.error('Order Error:', err.message);
        res.status(500).json({ error: 'Server failed to process order' });
    }
});

app.get('/oauth2callback', async (req, res) => {
    const { code } = req.query; // This is the "key" Google sends back
    // ... logic to save the token ...
    res.redirect('/'); // Send the user back to the bakery home page
});

app.listen(PORT, () => {
    console.log(`Bakery server listening on port ${PORT}`);
});
