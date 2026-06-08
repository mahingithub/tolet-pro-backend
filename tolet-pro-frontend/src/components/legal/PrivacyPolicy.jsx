// PrivacyPolicy.jsx — /privacy-policy  [Phase 7]
// ───────────────────────────────────────────────────────────────────────────
// DRAFT legal text — a reasonable starting template for a Bangladesh rental
// app. NOT a substitute for review by a qualified lawyer, especially before
// scaling or adding payments.
//
// ► FILL IN: the [COMPANY EMAIL] placeholder (search this file) once you have a
//   support/contact email.

import React, { useState } from 'react';
import LegalPage, { Section, H2, P, LI } from './LegalPage';

// One place to edit the contact email later.
const CONTACT_EMAIL = '[COMPANY EMAIL — e.g. support@toletpro.com]';

export default function PrivacyPolicy() {
  const [lang, setLang] = useState('en');
  const isBn = lang === 'bn';
  const t = (en, bn) => (isBn ? bn : en);

  return (
    <LegalPage
      titleEn="Privacy Policy"
      titleBn="গোপনীয়তা নীতি"
      lastUpdated={t('May 2026', 'মে ২০২৬')}
      lang={lang}
      setLang={setLang}
    >
      <Section>
        <P>
          {t(
            'TO-LET PRO ("we", "us", "our") helps people in Bangladesh find and list rental properties. This policy explains what information we collect, how we use it, and the choices you have.',
            'TO-LET PRO ("আমরা", "আমাদের") বাংলাদেশের মানুষকে ভাড়ার সম্পত্তি খুঁজতে ও তালিকাভুক্ত করতে সাহায্য করে। এই নীতিতে আমরা কী তথ্য সংগ্রহ করি, কীভাবে ব্যবহার করি, এবং আপনার কী কী পছন্দ আছে তা ব্যাখ্যা করা হয়েছে।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('1. Information We Collect', '১. আমরা যে তথ্য সংগ্রহ করি')}</H2>
        <P>{t('We collect information you provide directly, including:', 'আপনি সরাসরি যে তথ্য দেন তা আমরা সংগ্রহ করি, যেমন:')}</P>
        <ul style={{ paddingLeft: '20px' }}>
          <LI>{t('Account details: name, phone number, and password.', 'অ্যাকাউন্টের তথ্য: নাম, ফোন নম্বর, এবং পাসওয়ার্ড।')}</LI>
          <LI>{t('Verification documents you choose to upload (e.g. National ID, profile photo, profession proof, utility bill for landlords).', 'আপনি যে যাচাইকরণ নথি আপলোড করতে চান (যেমন জাতীয় পরিচয়পত্র, প্রোফাইল ছবি, পেশার প্রমাণ, বাড়িওয়ালাদের জন্য ইউটিলিটি বিল)।')}</LI>
          <LI>{t('Property listings, photos, and descriptions you post.', 'আপনি যে সম্পত্তির তালিকা, ছবি ও বিবরণ পোস্ট করেন।')}</LI>
          <LI>{t('Messages and call activity between users on the platform.', 'প্ল্যাটফর্মে ব্যবহারকারীদের মধ্যে বার্তা ও কল কার্যকলাপ।')}</LI>
          <LI>{t('Optional profile information such as email, date of birth, profession, and emergency contact.', 'ঐচ্ছিক প্রোফাইল তথ্য যেমন ইমেইল, জন্মতারিখ, পেশা, এবং জরুরি যোগাযোগ।')}</LI>
        </ul>
        <P>
          {t(
            'We also automatically collect limited technical data (device type, approximate location, and usage activity) to operate and improve the service.',
            'সেবা পরিচালনা ও উন্নত করতে আমরা সীমিত কারিগরি তথ্যও স্বয়ংক্রিয়ভাবে সংগ্রহ করি (ডিভাইসের ধরন, আনুমানিক অবস্থান, এবং ব্যবহারের কার্যকলাপ)।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('2. How We Use Your Information', '২. আমরা কীভাবে আপনার তথ্য ব্যবহার করি')}</H2>
        <ul style={{ paddingLeft: '20px' }}>
          <LI>{t('To create and manage your account and verify your identity.', 'আপনার অ্যাকাউন্ট তৈরি ও পরিচালনা এবং পরিচয় যাচাই করতে।')}</LI>
          <LI>{t('To display your listings and connect tenants with landlords.', 'আপনার তালিকা দেখাতে এবং ভাড়াটে ও বাড়িওয়ালাদের সংযুক্ত করতে।')}</LI>
          <LI>{t('To enable messaging, calls, and notifications.', 'বার্তা, কল, এবং নোটিফিকেশন সক্ষম করতে।')}</LI>
          <LI>{t('To maintain safety, prevent fraud, and enforce our terms.', 'নিরাপত্তা বজায় রাখতে, জালিয়াতি রোধ করতে, এবং আমাদের শর্তাবলী প্রয়োগ করতে।')}</LI>
          <LI>{t('To improve features and provide support.', 'ফিচার উন্নত করতে এবং সহায়তা প্রদান করতে।')}</LI>
        </ul>
      </Section>

      <Section>
        <H2>{t('3. Service Providers', '৩. সেবা প্রদানকারী')}</H2>
        <P>
          {t(
            'We use trusted third-party services to run the platform: Firebase (authentication and notifications), Cloudinary (image storage), MongoDB Atlas (database hosting), and cloud hosting providers. These providers process data on our behalf under their own security and privacy commitments.',
            'প্ল্যাটফর্ম চালাতে আমরা বিশ্বস্ত তৃতীয় পক্ষের সেবা ব্যবহার করি: Firebase (প্রমাণীকরণ ও নোটিফিকেশন), Cloudinary (ছবি সংরক্ষণ), MongoDB Atlas (ডাটাবেস হোস্টিং), এবং ক্লাউড হোস্টিং প্রদানকারী। এই প্রদানকারীরা তাদের নিজস্ব নিরাপত্তা ও গোপনীয়তা প্রতিশ্রুতির অধীনে আমাদের পক্ষে তথ্য প্রক্রিয়া করে।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('4. Sharing and Visibility', '৪. শেয়ারিং ও দৃশ্যমানতা')}</H2>
        <P>
          {t(
            'Your listings and public profile information are visible to other users so the marketplace can work. Your verification documents are used only for trust and verification and are not shown publicly. We do not sell your personal information.',
            'মার্কেটপ্লেস কাজ করার জন্য আপনার তালিকা ও পাবলিক প্রোফাইল তথ্য অন্য ব্যবহারকারীদের কাছে দৃশ্যমান। আপনার যাচাইকরণ নথি শুধু আস্থা ও যাচাইয়ের জন্য ব্যবহৃত হয় এবং প্রকাশ্যে দেখানো হয় না। আমরা আপনার ব্যক্তিগত তথ্য বিক্রি করি না।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('5. Your Rights and Choices', '৫. আপনার অধিকার ও পছন্দ')}</H2>
        <ul style={{ paddingLeft: '20px' }}>
          <LI>{t('Access and update your profile information at any time.', 'যেকোনো সময় আপনার প্রোফাইল তথ্য দেখতে ও হালনাগাদ করতে পারেন।')}</LI>
          <LI>{t('Control your privacy and notification settings in the Privacy Center.', 'প্রাইভেসি সেন্টারে আপনার গোপনীয়তা ও নোটিফিকেশন সেটিংস নিয়ন্ত্রণ করতে পারেন।')}</LI>
          <LI>{t('Request deletion of your account, subject to a short restore window.', 'একটি সংক্ষিপ্ত পুনরুদ্ধার সময়সীমা সাপেক্ষে আপনার অ্যাকাউন্ট মুছে ফেলার অনুরোধ করতে পারেন।')}</LI>
        </ul>
      </Section>

      <Section>
        <H2>{t('6. Data Security', '৬. তথ্য নিরাপত্তা')}</H2>
        <P>
          {t(
            'We use reasonable technical and organisational measures to protect your data, including encrypted connections and access controls. However, no online service can guarantee absolute security.',
            'আপনার তথ্য রক্ষা করতে আমরা যুক্তিসঙ্গত কারিগরি ও সাংগঠনিক ব্যবস্থা ব্যবহার করি, যার মধ্যে রয়েছে এনক্রিপ্টেড সংযোগ ও অ্যাক্সেস নিয়ন্ত্রণ। তবে, কোনো অনলাইন সেবা সম্পূর্ণ নিরাপত্তার নিশ্চয়তা দিতে পারে না।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('7. Children', '৭. শিশু')}</H2>
        <P>
          {t(
            'TO-LET PRO is intended for users aged 18 and above. We do not knowingly collect information from children.',
            'TO-LET PRO ১৮ বছর ও তার বেশি বয়সী ব্যবহারকারীদের জন্য। আমরা জেনেশুনে শিশুদের কাছ থেকে তথ্য সংগ্রহ করি না।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('8. Changes to This Policy', '৮. এই নীতির পরিবর্তন')}</H2>
        <P>
          {t(
            'We may update this policy from time to time. We will revise the "last updated" date above and, where appropriate, notify you in the app.',
            'আমরা সময়ে সময়ে এই নীতি হালনাগাদ করতে পারি। আমরা উপরের "সর্বশেষ হালনাগাদ" তারিখ পরিবর্তন করব এবং প্রয়োজনে অ্যাপে আপনাকে জানাব।'
          )}
        </P>
      </Section>

      <Section>
        <H2>{t('9. Contact Us', '৯. যোগাযোগ করুন')}</H2>
        <P>
          {t(
            `Questions about this policy? Reach us at ${CONTACT_EMAIL}.`,
            `এই নীতি সম্পর্কে প্রশ্ন? আমাদের সাথে যোগাযোগ করুন ${CONTACT_EMAIL}।`
          )}
        </P>
      </Section>
    </LegalPage>
  );
}
