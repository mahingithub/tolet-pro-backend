// RefundPolicy.jsx — /refund  [Phase 7]
// ───────────────────────────────────────────────────────────────────────────
// DRAFT legal text. TO-LET PRO currently has no paid features; this page sets
// expectations and is ready for when payments (e.g. landlord subscriptions)
// launch. NOT a substitute for review by a qualified lawyer — revisit this
// before charging real money.
//
// ► FILL IN: the [COMPANY EMAIL] placeholder once you have a contact email.

import React, { useState } from 'react';
import LegalPage, { Section, H2, P, LI } from './LegalPage';

const CONTACT_EMAIL = '[COMPANY EMAIL — e.g. support@toletpro.com]';

export default function RefundPolicy() {
  const [lang, setLang] = useState('en');
  const isBn = lang === 'bn';
  const t = (en, bn) => (isBn ? bn : en);

  return (
    <LegalPage
      titleEn="Refund Policy"
      titleBn="রিফান্ড নীতি"
      lastUpdated={t('May 2026', 'মে ২০২৬')}
      lang={lang}
      setLang={setLang}
    >
      <Section>
        <P>
          {t(
            'This Refund Policy explains how refunds work for any paid features on TO-LET PRO.',
            'এই রিফান্ড নীতিতে TO-LET PRO-এর যেকোনো পেইড ফিচারের জন্য রিফান্ড কীভাবে কাজ করে তা ব্যাখ্যা করা হয়েছে।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('1. Current Status', '১. বর্তমান অবস্থা')}</H2>
        <P>
          {t(
            'TO-LET PRO is currently free to use. There are no paid subscriptions or fees at this time, so no payments are collected and no refunds apply. This policy is provided in advance so our terms are clear if paid features are introduced later.',
            'TO-LET PRO বর্তমানে বিনামূল্যে ব্যবহারযোগ্য। এই মুহূর্তে কোনো পেইড সাবস্ক্রিপশন বা ফি নেই, তাই কোনো অর্থ সংগ্রহ করা হয় না এবং কোনো রিফান্ড প্রযোজ্য নয়। ভবিষ্যতে পেইড ফিচার চালু হলে আমাদের শর্ত যেন স্পষ্ট থাকে, সেজন্য এই নীতি আগেই দেওয়া হলো।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('2. Future Paid Features', '২. ভবিষ্যতের পেইড ফিচার')}</H2>
        <P>
          {t(
            'If we introduce paid features (for example, premium landlord subscriptions or promoted listings), the following principles will apply unless stated otherwise at the point of purchase:',
            'আমরা যদি পেইড ফিচার চালু করি (যেমন প্রিমিয়াম বাড়িওয়ালা সাবস্ক্রিপশন বা প্রচারিত তালিকা), তাহলে ক্রয়ের সময় অন্যভাবে উল্লেখ না থাকলে নিম্নলিখিত নীতিগুলো প্রযোজ্য হবে:'
          )}
        </P>
        <ul style={{ paddingLeft: '20px' }}>
          <LI>{t('Subscription fees are generally non-refundable once a billing period has started.', 'একটি বিলিং সময়কাল শুরু হয়ে গেলে সাবস্ক্রিপশন ফি সাধারণত ফেরতযোগ্য নয়।')}</LI>
          <LI>{t('You can cancel an active subscription to stop future renewals; access continues until the end of the paid period.', 'ভবিষ্যতের নবায়ন বন্ধ করতে আপনি একটি সক্রিয় সাবস্ক্রিপশন বাতিল করতে পারেন; পেইড সময়কালের শেষ পর্যন্ত অ্যাক্সেস চালু থাকে।')}</LI>
          <LI>{t('Refunds may be considered for duplicate charges or proven technical errors.', 'ডুপ্লিকেট চার্জ বা প্রমাণিত কারিগরি ত্রুটির জন্য রিফান্ড বিবেচনা করা হতে পারে।')}</LI>
        </ul>
      </Section>

      <Section>
        <H2>{t('3. How to Request a Refund', '৩. কীভাবে রিফান্ডের অনুরোধ করবেন')}</H2>
        <P>
          {t(
            `When paid features are available, you will be able to request a refund by contacting us at ${CONTACT_EMAIL} with your account details and the reason for the request. We aim to respond within a reasonable time.`,
            `পেইড ফিচার উপলব্ধ হলে, আপনি আপনার অ্যাকাউন্টের তথ্য ও অনুরোধের কারণসহ ${CONTACT_EMAIL}-এ যোগাযোগ করে রিফান্ডের অনুরোধ করতে পারবেন। আমরা যুক্তিসঙ্গত সময়ের মধ্যে সাড়া দেওয়ার চেষ্টা করি।`
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('4. Changes to This Policy', '৪. এই নীতির পরিবর্তন')}</H2>
        <P>
          {t(
            'We will update this policy before launching any paid features, and the "last updated" date above will reflect the change.',
            'কোনো পেইড ফিচার চালু করার আগে আমরা এই নীতি হালনাগাদ করব, এবং উপরের "সর্বশেষ হালনাগাদ" তারিখ সেই পরিবর্তন প্রতিফলিত করবে।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('5. Contact Us', '৫. যোগাযোগ করুন')}</H2>
        <P>
          {t(
            `Questions about refunds? Reach us at ${CONTACT_EMAIL}.`,
            `রিফান্ড সম্পর্কে প্রশ্ন? আমাদের সাথে যোগাযোগ করুন ${CONTACT_EMAIL}।`
          )}
        </P>
      </Section>
    </LegalPage>
  );
}
