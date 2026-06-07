const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const token = JSON.parse(data).token;
    console.log("Token:", token);
    // Find host bookings
    const bReq = http.request({
      hostname: 'localhost', port: 5000, path: '/api/bookings/host',
      method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
    }, (bRes) => {
      let bData = '';
      bRes.on('data', chunk => bData += chunk);
      bRes.on('end', () => {
        const bookings = JSON.parse(bData).bookings;
        if (!bookings || bookings.length === 0) return console.log("No bookings");
        const booking = bookings[0];
        console.log("Booking:", booking._id);
        
        // Make payment
        const pReq = http.request({
          hostname: 'localhost', port: 5000, path: `/api/bookings/${booking._id}/ledger/2026-06`,
          method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        }, (pRes) => {
          let pData = '';
          pRes.on('data', chunk => pData += chunk);
          pRes.on('end', () => {
            console.log("Payment response:", pRes.statusCode, pData);
            process.exit(0);
          });
        });
        pReq.write(JSON.stringify({
          status: 'full', paidOn: '2026-06-06', amount: 5000, balance: 0, method: 'Cash'
        }));
        pReq.end();
      });
    });
    bReq.end();
  });
});

req.write(JSON.stringify({ phone: '1234567890', password: 'password' })); // using host credentials
req.end();
