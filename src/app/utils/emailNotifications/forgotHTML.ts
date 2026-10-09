export const forgotEmailTemplate = (otp: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Email Verification</title>
</head>
<body style="margin:0; padding:0; background:#f4f6f8; font-family:Arial, sans-serif;">
 
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0; padding:0; width:100%;">
<tr>
<td align="center" style="padding:40px 15px;">
<!-- Container -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" 

               style="max-width:600px; background:#ffffff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); overflow:hidden;">
<!-- Header with Gradient Background -->
<tr>
<td align="center" 

                style="padding:50px 20px 40px 20px;

                       background: linear-gradient(#a7c18c, #1e1e1f) padding-box,

                                  linear-gradient(to bottom, #a1a1a1 0%, #1e1e1f 2px, rgba(167,193,140,0.1) 80%, transparent 100%) border-box;">

<h2 style="margin:20px 0 0 0; font-size:22px; font-weight:600; color:#ffffff;">Verify your Email</h2>
</td>
</tr>
 
          <!-- Content -->
<tr>
<td style="padding:30px 40px 20px 40px; text-align:left; color:#5a6c7d; font-size:15px; line-height:1.6;">
<p style="margin:0 0 15px 0;">Hello,</p>
<p style="margin:0;">Welcome to <strong style="color:#2c3e50;">Resqueu</strong>.  

              We received a request to reset the password for your account on Resqueu. Use this OTP to complete the password reset process.</p>
</td>
</tr>
 
          <!-- OTP Section -->
<tr>
<td align="center" style="padding:20px 40px;">
<div style="background:#f4f6f8; border-radius:6px; padding:25px; display:inline-block;">
<p style="margin:0 0 10px 0; font-size:14px; color:#2c3e50; font-weight:600;">Your OTP code</p>
<p style="margin:0; font-size:32px; font-weight:700; color:#2c3e50; letter-spacing:4px; font-family:'Courier New', monospace;">

                  ${otp}
</p>
</div>
</td>
</tr>
 
          <!-- Warning -->
<tr>
<td style="padding:20px 40px 30px 40px; font-size:13px; color:#7f8c8d; line-height:1.5; text-align:center;">

              ⚠️ Keep this code private. Resqueu will never request it from you.
</td>
</tr>
 
          <!-- Footer -->
<tr>
<td align="center" style="padding:30px 20px; background:#f9f9f9; border-top:1px solid #eee;">
<p style="margin:0; font-size:14px; color:#2c3e50;">Best regards,</p>
<p style="margin:0; font-size:13px; color:#7f8c8d;">Team Resqueu</p>
</td>
</tr>
 
        </table>
</td>
</tr>
</table>
 
</body>
</html>`;
