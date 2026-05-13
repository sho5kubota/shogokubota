function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function onRequestPost({ request, env }) {
  const formData = await request.formData();
  const name = (formData.get('Name') || '').slice(0, 200).replace(/[\r\n]/g, '');
  const email = (formData.get('Email') || '').slice(0, 200).replace(/[\r\n]/g, '');
  const message = (formData.get('Message') || '').slice(0, 5000);
  const confirm = formData.get('Confirm');

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!name || !email || !confirm || !emailRegex.test(email)) {
    return new Response('Bad Request', { status: 400 });
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Sho5 Guide Service <noreply@shogokubota.com>',
      to: ['sho5.kubota@gmail.com'],
      reply_to: email,
      subject: `[shogokubota.com] お問い合わせ from ${name}`,
      text: `名前: ${name}\nメール: ${email}\n\nメッセージ:\n${message}`,
      html: `<p><strong>名前:</strong> ${safeName}</p><p><strong>メール:</strong> ${safeEmail}</p><p><strong>メッセージ:</strong></p><pre>${safeMessage}</pre>`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
    return new Response('Mail delivery failed', { status: 500 });
  }

  const autoReplyText = `${name} 様

お問い合わせいただきありがとうございます。
内容を確認の上、折り返しご連絡いたします。

■ お問い合わせ内容
【お名前】${name}
【メールアドレス】${email}
【お問い合わせ】${message}

ご不明な点がございましたらお気軽にご連絡ください。
よろしくお願いいたします。

久保田将吾
WhatsApp +81 90-8336-0238
Sho5 Guide Service
https://shogokubota.com`;

  const autoReplyHtml = `<p>${safeName} 様</p>
<p>お問い合わせいただきありがとうございます。<br>
内容を確認の上、折り返しご連絡いたします。</p>
<p><strong>■ お問い合わせ内容</strong><br>
【お名前】${safeName}<br>
【メールアドレス】${safeEmail}<br>
【お問い合わせ】<br><pre style="font-family:inherit;">${safeMessage}</pre></p>
<p>ご不明な点がございましたらお気軽にご連絡ください。<br>
よろしくお願いいたします。</p>
<p>久保田将吾<br>
WhatsApp +81 90-8336-0238<br>
Sho5 Guide Service<br>
<a href="https://shogokubota.com">https://shogokubota.com</a></p>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Sho5 Guide Service <noreply@shogokubota.com>',
      to: [email],
      reply_to: 'sho5.kubota@gmail.com',
      subject: 'お問い合わせありがとうございます - Sho5 Guide Service',
      text: autoReplyText,
      html: autoReplyHtml,
    }),
  });

  return Response.redirect(new URL('/thanks', request.url).toString(), 303);
}
