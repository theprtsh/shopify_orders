const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const fs = require('fs/promises');
const path = require('path');

// --- Configuration ---
const config = {
    imap: {
        user: 'vipin@agentflow.in',
        password: '1God;2z&b[Ie',
        host: 'imap.hostinger.com',
        port: 993,
        tls: true,
        authTimeout: 3000
    }
};

const TARGET_SUBJECT_PATTERN = /\[Urban Threads\] Order #\d+ placed by .+/;
const JSON_FILENAME = 'shopify_orders.json';

// --- Logging ---
const log = (level, message) => {
    console.log(`${new Date().toISOString()} - ${level.toUpperCase()} - ${message}`);
};

/**
 * Extracts order details from the email body using regular expressions.
 * @param {string} subject The email subject.
 * @param {string} from The sender's email address.
 * @param {string} body The plain text email body.
 * @returns {object|null} An object with order details or null if no match.
 */
const processEmail = (subject, from, body) => {
    if (!TARGET_SUBJECT_PATTERN.test(subject.trim())) {
        log('info', `Skipping email with subject: "${subject}"`);
        return null;
    }

    const orderDetails = {
        customer_name: null,
        order_id: null,
        timestamp: null,
        customer_address: null,
        customer_email: null,
	phone_number: null
    };

    // Pattern for customer name, order ID, and timestamp
    const orderPattern = /(\w+\s+\w+)\s+placed\s+order\s+#(\d+)\s+on\s+([\w\s,]+ at \d{1,2}:\d{2}\s+[ap]m)/i;
    const orderMatch = body.match(orderPattern);
    if (orderMatch) {
        orderDetails.customer_name = orderMatch[1];
        orderDetails.order_id = orderMatch[2];
        orderDetails.timestamp = orderMatch[3];
    }

    // Pattern for shipping address

    	const addressPattern = /Shipping address\s*\n\s*([\s\S]*?)(?=Customer Email)/i;
	const addressMatch = body.match(addressPattern);
	
	if (addressMatch) {
	    let addressBlock = addressMatch[1]; // This is the full text block
	
	    // A general pattern to find a phone number. It looks for a line that contains
	    // at least 7 digits and may include a '+', spaces, hyphens, or parentheses.
	    // The 'm' flag is for multi-line matching.
	    const phonePattern = /(?:^|\n)\s*(\+?[\d\s\-\(\)]{7,})\s*$/m;
	    const phoneMatch = addressBlock.match(phonePattern);
	
	    if (phoneMatch) {
	        // Phone number found, extract it and clean it up.
	        orderDetails.phone_number = phoneMatch[1].trim();
	
	        // Remove the matched phone number from the address block to clean it up.
	        addressBlock = addressBlock.replace(phonePattern, '').trim();
	    }
	
	    // Process the remaining address block (now without the phone number).
	    // This cleans up extra whitespace and empty lines.
	    orderDetails.customer_address = addressBlock.split('\n')
	        .map(line => line.trim())
	        .filter(line => line) // Removes any empty lines
	        .join('\n');
	}









    // Pattern for customer email
    const emailPattern = /Customer Email\s*\n\s*(\S+@\S+\.\S+)/i;
    const emailMatch = body.match(emailPattern);
    if (emailMatch) {
        orderDetails.customer_email = emailMatch[1];
    }

    log('info', `Successfully processed email with subject: "${subject}"`);
    return orderDetails;
};

/**
 * Checks the email account for new orders and processes them.
 */
const checkHostingerEmail = async () => {
    let connection;
    try {
        log('info', 'Connecting to Hostinger mail server...');
        connection = await imaps.connect(config);
        log('info', 'Successfully connected and logged in.');

        await connection.openBox('INBOX');
        log('info', 'Inbox selected.');

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = {
            bodies: [''],
            markSeen: true
        };

        const messages = await connection.search(searchCriteria, fetchOptions);
        log('info', `Found ${messages.length} new emails.`);

        const allOrders = [];

        for (const message of messages) {
            const allPart = message.parts.find(part => part.which === '');
            if (allPart) {
                const parsed = await simpleParser(allPart.body);
                const orderDetails = processEmail(parsed.subject || 'No Subject', parsed.from.text, parsed.text);
                if (orderDetails) {
                    allOrders.push(orderDetails);
                }
            }
        }

        if (allOrders.length > 0) {
            let existingOrders = [];
            try {
                // Check if file exists and is not empty
                await fs.access(JSON_FILENAME);
                const fileContent = await fs.readFile(JSON_FILENAME, 'utf-8');
                if (fileContent) {
                    existingOrders = JSON.parse(fileContent);
                    if (!Array.isArray(existingOrders)) {
                        existingOrders = [];
                    }
                }
            } catch (error) {
                // If file does not exist or is empty, start with an empty array
                if (error.code !== 'ENOENT') {
                   log('error', `Error reading or parsing JSON file: ${error.message}`);
                }
            }

            const updatedOrders = existingOrders.concat(allOrders);
            await fs.writeFile(JSON_FILENAME, JSON.stringify(updatedOrders, null, 4), 'utf-8');
            log('info', `${allOrders.length} new orders have been saved to ${JSON_FILENAME}`);
        }

        log('info', 'Email check and process completed successfully.');
    } catch (e) {
        log('error', `An error occurred: ${e.message}`);
    } finally {
        if (connection) {
            connection.end();
        }
    }
};

// --- Main Execution Logic ---
const runEmailCheckLoop = () => {
    checkHostingerEmail()
        .catch(err => log('error', `Failed to run email check: ${err.message}`))
        .finally(() => {
            log('info', 'Waiting for 5 seconds before the next check...');
            setTimeout(runEmailCheckLoop, 5000);
        });
};

// Start the continuous loop
runEmailCheckLoop();
