import { legalMeta as m } from './legalMeta.ts'

/**
 * In-app legal texts (Privacy Policy and Terms), the authoritative source; the
 * docs/legal/*.md files are their English export (`npm run legal:export`, and
 * a test fails when they differ). Written to match what Peerly 2.0 does:
 * invite-only workspaces whose content goes between the members' devices,
 * end-to-end encrypted, a server that signs people in, checks who may enter
 * and introduces devices, and, for a premium owner, keeps encrypted history
 * and relays connections.
 *
 * Not a substitute for review by a lawyer before a commercial launch.
 */
export type LegalBlock = { p: string } | { ul: string[] } | { note: string }
export type LegalSection = { heading: string; blocks: LegalBlock[] }
export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] }
export type LegalDocId = 'privacy' | 'terms'

const updatedLabel = { pl: `Ostatnia aktualizacja: ${m.lastUpdated}`, en: `Last updated: ${m.lastUpdated}` }

// ---------------------------------------------------------------------------
// Privacy Policy
// ---------------------------------------------------------------------------

const privacyEn: LegalDoc = {
  title: 'Privacy Policy',
  updated: updatedLabel.en,
  intro:
    'Peerly is team chat in invite-only workspaces. What you write goes directly between the members’ devices (peer to peer), encrypted end to end. Our servers sign you in, let only the people a workspace lists in, introduce members’ devices to each other and, when a workspace’s owner has Premium, keep its encrypted history. This document explains what data that involves and what rights you have.',
  sections: [
    {
      heading: '1. Data controller',
      blocks: [
        { p: `The data controller is ${m.controller} (a natural person operating Peerly), ${m.country}. Privacy contact: ${m.privacyEmail}.` },
      ],
    },
    {
      heading: '2. How Peerly works',
      blocks: [
        { p: 'Each workspace has a secret made on its owner’s device. It travels only inside the invite link’s fragment (the part after #, which browsers never send to a server) and stays on members’ devices. The key that encrypts the workspace’s content comes from that secret, so our servers can neither read the content nor find the workspace from it.' },
        { p: 'The owner signs the workspace’s list of email addresses with their account key. Only people on that list can enter, whoever holds the link.' },
        { p: 'Members’ devices connect directly (WebRTC) and pass messages to each other. Each device keeps what it has received and passes it on to members it meets later, so someone who was away catches up from whoever is online. Without Premium, nothing you write is kept on our servers.' },
      ],
    },
    {
      heading: '3. What data is processed',
      blocks: [
        { p: 'Signing in: you sign in with Google, Microsoft, Apple or your organization’s sign-in (OpenID Connect). Your browser sends us the provider’s identity token once, to verify it. We keep neither the token nor your email address or name on our servers. From the token we derive your account ID (a one-way hash of the provider and your account with it), an internal ID (a keyed hash of the account ID) and a member ID (a keyed hash of your email address), which is how a workspace’s list recognizes you. Your name, email address and photo address from the token stay in your browser, to show who is signed in.' },
        { p: 'Devices and sessions: your device makes a key of its own, which cannot leave the browser; we keep its public half, your sessions (which device, until when) and the cookie that carries a session. When you link devices, we keep each device’s name (its browser and system, which you can change), when it was linked and last active, its certificate, and your account’s keys sealed for each linked device, which we cannot open.' },
        { p: 'Entering a workspace: when you open a workspace, your device sends the owner-signed list of members’ email addresses. Our Worker checks the signature, derives each member ID and lets you in if yours is among them. The workspace’s channel keeps only those member IDs and a routing ID derived from the workspace’s secret (not the secret); the email addresses are not kept.' },
        { p: 'While you are online: the workspace’s channel (a Cloudflare Durable Object) knows which account IDs and devices are connected, and passes on encrypted messages, names, typing notices and the set-up of direct connections between members’ devices. It cannot read them.' },
        { p: 'Content: messages, edits, deletions, reactions, channel names and the workspace’s name are signed by the device that wrote them and encrypted. They go directly to the members’ devices. If the workspace’s owner has Premium, its channel also keeps encrypted copies of the latest 5,000 changes, so members get them when they come back; this history ends when the owner’s Premium does.' },
        { p: 'Files: a file you attach is kept on your device and goes directly to the members who open it; its name, type, size and, for an image, a small preview travel inside the encrypted message. Members’ devices keep the files they open and pass them to other members who ask. If the workspace’s owner has Premium, your device also seals each file with the workspace’s key and stores it in Cloudflare R2 under a name derived from the key, so members can get it while nobody who has it is online. We cannot open these files or tell which file one is; we see their size and when they were stored. Each workspace may keep up to 5 GB, and the files are deleted when the owner’s Premium ends.' },
        { p: 'Your name in a workspace: the name you signed in with is sent, encrypted, to the members you meet. Their devices remember the names they have seen in that workspace, and may pass them to other members who have not seen you.' },
        { p: 'IP address: to connect directly, members’ devices exchange their network addresses (ICE candidates) through the workspace’s channel, including the public address Cloudflare’s STUN server finds. The other members of your workspaces can therefore learn your IP address, and from it your approximate location and internet provider. A Premium account’s connections may go through Cloudflare’s TURN relay instead; Cloudflare then sees your IP address and the connection’s metadata, and the other members see the relay’s address. We pass these addresses only to members of the same workspace and do not keep them.' },
        { p: 'Your plan: we keep your account ID, when it first and last signed in (updated at most hourly), its plan, when the plan ends, who on our team granted it and when, and an optional note. Our team finds an account by the account ID shown in Settings, which you give them when you ask about your plan.' },
        { p: 'Diagnostics: for each request the service handles, we record which operation ran, its result, how long it took, and the app version. When something fails, we also keep the error message, where in the code it happened, and the service’s log lines for that request; these records hold no IP addresses, request contents or messages. Separately, Cloudflare’s own logs of our service keep each request’s technical details, including your IP address and browser identification (user agent), for 7 days, for security and troubleshooting.' },
        { p: 'Error reports: if the app fails in your browser, it sends us the error message and where in the app’s code it happened, which page it was on, the app version, and your browser’s name and major version, operating system and device type. Email addresses, links’ query strings and long identifiers are removed first. It holds no IP address, cookie or identifier.' },
        { p: 'Page views: each page of the app sends an anonymous view: which page it was (never a workspace, channel or account), the site or campaign that sent you, whether the view comes from a signed-in account, and whether the device is a phone, tablet or computer. The service adds the country, region and city Cloudflare estimates from your connection. Views carry no IP address, cookie or identifier, so they cannot be linked to each other or to you; we count them only in total.' },
        { p: 'On your device: your workspaces (their secrets and member lists), the messages, changes and files your device holds, the names it has seen, the device’s key and, once linked, your account’s keys (in IndexedDB); who is signed in, your theme, language and clock choices (in local storage); unsent drafts (for the tab only); and the app’s own files, so it opens offline (in the service worker’s cache).' },
        { note: 'No advertising, no tracking pixels, no visitor IDs, no profiling. We do not sell data.' },
      ],
    },
    {
      heading: '4. Legal bases (GDPR Art. 6)',
      blocks: [
        { ul: [
          'Performing the service you ask for (Art. 6(1)(b)): signing in, checking a workspace’s list, connecting members’ devices, a Premium workspace’s history and relays, your plan.',
          'Legitimate interests (Art. 6(1)(f)): security, preventing abuse, diagnostics and error reports to keep the service working, and counting page views in total.',
          'Workspace owners decide whose email addresses their lists hold, and need their own basis for inviting those people.',
        ] },
      ],
    },
    {
      heading: '5. Who can see your data',
      blocks: [
        { ul: [
          'Members of your workspaces: your name, what you write there, when you are online, and your IP address when your devices connect directly. Members see the workspace’s list of email addresses.',
          'Cloudflare, which hosts the service: encrypted content, account and device IDs, connection metadata and IP addresses (request logs, STUN, TURN); not the keys to the content.',
          'Our team, in CodeFusion Console (the operator’s administration tool, also on Cloudflare): your account ID, when you were first and last seen and your plan; diagnostics and error reports.',
          'The provider you sign in with, which knows you signed in to Peerly.',
        ] },
      ],
    },
    {
      heading: '6. Processors',
      blocks: [
        { ul: [
          'Cloudflare Workers and Durable Objects: sign-in, sessions, devices, workspace channels, encrypted history, plans.',
          'Cloudflare R2: a Premium workspace’s sealed files.',
          'Cloudflare STUN and TURN: finding a device’s public address for direct connections, and relaying a Premium account’s connections.',
          'Cloudflare Static Assets: serving the app’s files.',
          'Cloudflare Workers Analytics Engine and D1, through CodeFusion Console: diagnostics, error reports and page view counts.',
          'Identity providers (Google, Microsoft, Apple, or your organization’s): signing in.',
        ] },
        { p: 'Cloudflare may process data outside the European Economic Area under the EU Standard Contractual Clauses and the EU–US Data Privacy Framework.' },
      ],
    },
    {
      heading: '7. Retention',
      blocks: [
        { ul: [
          'On your devices: until you leave the workspace, clear messages in Settings → Storage, or clear the browser’s data. Signing out keeps them for when you sign in again.',
          'Sessions: until they expire (30 days without use) or you sign out. Linked devices: until you unlink them.',
          'A workspace’s member IDs: while the workspace is used; a newer list replaces them.',
          'A Premium workspace’s history: the latest 5,000 changes, and its sealed files, while the owner’s Premium lasts; both are deleted when Premium ends.',
          'Your account ID, devices and plan: until you ask us to delete your account.',
          'Error reports: 30 days; request, diagnostics and page view statistics: 3 months; Cloudflare’s request logs: 7 days.',
        ] },
      ],
    },
    {
      heading: '8. Your rights',
      blocks: [
        { p: `You may ask for access to your data, its correction or deletion, restriction of processing and a copy (portability), and object to processing based on legitimate interests. Write to ${m.privacyEmail} with your account ID from Settings: we keep no email address to find you by. You may also lodge a complaint with ${m.supervisoryAuthority}.` },
        { p: 'We cannot delete copies of your messages that other members’ devices already hold; ask the workspace’s members, or leave and ask its owner to remove you from the list.' },
      ],
    },
    {
      heading: '9. Cookies and local storage',
      blocks: [
        { p: 'Peerly sets one cookie, which carries your session to our servers, is readable only by them and lasts 30 minutes at a time. Local storage and IndexedDB hold what section 3 lists. All of it is needed for the service you asked for; there are no analytics or advertising cookies, so we do not ask for consent.' },
      ],
    },
    {
      heading: '10. Age',
      blocks: [{ p: `Peerly is for people aged ${m.minAge} or over.` }],
    },
    {
      heading: '11. Security',
      blocks: [
        { p: 'Content is encrypted end to end with keys our servers never receive, and every change is signed by the device that made it; a device’s key cannot be copied out of its browser. Traffic to our servers uses HTTPS. Keep your devices locked and approve new devices only when they are yours: anyone with your unlocked device can read your workspaces.' },
      ],
    },
    {
      heading: '12. Changes',
      blocks: [{ p: 'We will update this policy when Peerly changes what it processes, and show the date of the latest update at the top.' }],
    },
    {
      heading: '13. Contact',
      blocks: [{ p: `${m.controller} · ${m.privacyEmail}` }],
    },
  ],
}

const privacyPl: LegalDoc = {
  title: 'Polityka prywatności',
  updated: updatedLabel.pl,
  intro:
    'Peerly to czat zespołowy w przestrzeniach dostępnych tylko dla zaproszonych. To, co piszesz, trafia bezpośrednio między urządzeniami członków (peer to peer) i jest szyfrowane od końca do końca. Nasze serwery logują Cię, wpuszczają do przestrzeni tylko osoby z jej listy, zapoznają ze sobą urządzenia członków, a gdy właściciel przestrzeni ma Premium, przechowują jej zaszyfrowaną historię. Ten dokument wyjaśnia, jakie dane się z tym wiążą i jakie masz prawa.',
  sections: [
    {
      heading: '1. Administrator danych',
      blocks: [
        { p: `Administratorem danych jest ${m.controller} (osoba fizyczna prowadząca Peerly), ${m.country}. Kontakt w sprawach prywatności: ${m.privacyEmail}.` },
      ],
    },
    {
      heading: '2. Jak działa Peerly',
      blocks: [
        { p: 'Każda przestrzeń ma sekret utworzony na urządzeniu jej właściciela. Podróżuje on wyłącznie we fragmencie linku z zaproszeniem (część po znaku #, której przeglądarki nigdy nie wysyłają do serwera) i pozostaje na urządzeniach członków. Klucz szyfrujący treść przestrzeni pochodzi z tego sekretu, więc nasze serwery nie mogą ani odczytać treści, ani na jego podstawie odnaleźć przestrzeni.' },
        { p: 'Właściciel podpisuje listę adresów e-mail przestrzeni kluczem swojego konta. Wejść mogą tylko osoby z tej listy, niezależnie od tego, kto ma link.' },
        { p: 'Urządzenia członków łączą się bezpośrednio (WebRTC) i przekazują sobie wiadomości. Każde urządzenie zachowuje to, co otrzymało, i przekazuje to członkom, których spotka później, więc osoba, której nie było, nadrabia zaległości od tych, którzy są online. Bez Premium nic, co piszesz, nie jest przechowywane na naszych serwerach.' },
      ],
    },
    {
      heading: '3. Jakie dane są przetwarzane',
      blocks: [
        { p: 'Logowanie: logujesz się przez Google, Microsoft, Apple lub logowanie swojej organizacji (OpenID Connect). Przeglądarka wysyła nam raz token tożsamości dostawcy, abyśmy go zweryfikowali. Na naszych serwerach nie zachowujemy ani tokenu, ani Twojego adresu e-mail czy imienia. Z tokenu wyprowadzamy identyfikator konta (jednokierunkowy skrót dostawcy i Twojego konta u niego), identyfikator wewnętrzny (skrót identyfikatora konta z tajnym kluczem) oraz identyfikator członka (skrót adresu e-mail z tajnym kluczem), po którym rozpoznaje Cię lista przestrzeni. Imię, adres e-mail i adres zdjęcia z tokenu pozostają w Twojej przeglądarce, aby pokazać, kto jest zalogowany.' },
        { p: 'Urządzenia i sesje: Twoje urządzenie tworzy własny klucz, który nie może opuścić przeglądarki; przechowujemy jego część publiczną, Twoje sesje (które urządzenie, do kiedy) i plik cookie przenoszący sesję. Gdy łączysz urządzenia, przechowujemy nazwę każdego z nich (przeglądarkę i system, które możesz zmienić), datę połączenia i ostatniej aktywności, jego certyfikat oraz klucze Twojego konta zapieczętowane dla każdego połączonego urządzenia, których nie możemy otworzyć.' },
        { p: 'Wejście do przestrzeni: gdy otwierasz przestrzeń, Twoje urządzenie wysyła podpisaną przez właściciela listę adresów e-mail członków. Nasz Worker sprawdza podpis, wyprowadza identyfikator każdego członka i wpuszcza Cię, jeśli Twój jest wśród nich. Kanał przestrzeni zachowuje tylko te identyfikatory członków oraz identyfikator trasy wyprowadzony z sekretu przestrzeni (nie sam sekret); adresy e-mail nie są przechowywane.' },
        { p: 'Gdy jesteś online: kanał przestrzeni (Cloudflare Durable Object) wie, które identyfikatory kont i urządzeń są połączone, i przekazuje zaszyfrowane wiadomości, imiona, informacje o pisaniu oraz zestawianie bezpośrednich połączeń między urządzeniami członków. Nie może ich odczytać.' },
        { p: 'Treść: wiadomości, ich edycje i usunięcia, reakcje, nazwy kanałów i nazwa przestrzeni są podpisywane przez urządzenie, które je utworzyło, i szyfrowane. Trafiają bezpośrednio do urządzeń członków. Jeśli właściciel przestrzeni ma Premium, jej kanał przechowuje także zaszyfrowane kopie ostatnich 5000 zmian, aby członkowie otrzymali je po powrocie; ta historia kończy się wraz z Premium właściciela.' },
        { p: 'Pliki: dołączony plik jest przechowywany na Twoim urządzeniu i trafia bezpośrednio do członków, którzy go otwierają; jego nazwa, typ, rozmiar, a w przypadku obrazu także mały podgląd, podróżują wewnątrz zaszyfrowanej wiadomości. Urządzenia członków zachowują otwarte pliki i przekazują je innym członkom, którzy o nie poproszą. Jeśli właściciel przestrzeni ma Premium, Twoje urządzenie dodatkowo pieczętuje każdy plik kluczem przestrzeni i zapisuje go w Cloudflare R2 pod nazwą wyprowadzoną z klucza, aby członkowie mogli go pobrać, gdy nikt, kto go ma, nie jest online. Nie możemy otworzyć tych plików ani ustalić, który to plik; widzimy ich rozmiar i czas zapisania. Każda przestrzeń może przechowywać do 5 GB, a pliki są usuwane, gdy kończy się Premium właściciela.' },
        { p: 'Twoje imię w przestrzeni: imię, którym się logujesz, jest wysyłane w postaci zaszyfrowanej do członków, których spotykasz. Ich urządzenia zapamiętują imiona widziane w tej przestrzeni i mogą przekazać je członkom, którzy Cię jeszcze nie widzieli.' },
        { p: 'Adres IP: aby połączyć się bezpośrednio, urządzenia członków wymieniają przez kanał przestrzeni swoje adresy sieciowe (kandydatów ICE), w tym publiczny adres, który ustala serwer STUN Cloudflare. Pozostali członkowie Twoich przestrzeni mogą więc poznać Twój adres IP, a z niego przybliżoną lokalizację i dostawcę internetu. Połączenia konta Premium mogą zamiast tego iść przez przekaźnik TURN Cloudflare; wtedy Twój adres IP i metadane połączenia widzi Cloudflare, a pozostali członkowie widzą adres przekaźnika. Przekazujemy te adresy tylko członkom tej samej przestrzeni i ich nie przechowujemy.' },
        { p: 'Twój plan: przechowujemy identyfikator konta, datę pierwszego i ostatniego logowania (aktualizowaną najwyżej raz na godzinę), plan, datę jego zakończenia, kto z naszego zespołu go przyznał i kiedy oraz opcjonalną notatkę. Nasz zespół odnajduje konto po identyfikatorze widocznym w Ustawieniach, który podajesz, pytając o swój plan.' },
        { p: 'Diagnostyka: dla każdego żądania obsłużonego przez usługę zapisujemy, jaka operacja została wykonana, jej wynik, czas trwania i wersję aplikacji. Gdy coś się nie powiedzie, zachowujemy też komunikat błędu, miejsce w kodzie, w którym wystąpił, oraz wpisy dziennika usługi dla tego żądania; te zapisy nie zawierają adresów IP, treści żądań ani wiadomości. Niezależnie od tego Cloudflare w dziennikach naszej usługi przechowuje przez 7 dni techniczne szczegóły każdego żądania, w tym Twój adres IP i identyfikację przeglądarki (user agent), w celach bezpieczeństwa i diagnozowania problemów.' },
        { p: 'Raporty błędów: jeśli aplikacja zawiedzie w Twojej przeglądarce, wysyła nam komunikat błędu i miejsce w kodzie aplikacji, w którym wystąpił, stronę, na której to się stało, wersję aplikacji oraz nazwę i główną wersję przeglądarki, system operacyjny i rodzaj urządzenia. Adresy e-mail, parametry zapytań w linkach i długie identyfikatory są wcześniej usuwane. Raport nie zawiera adresu IP, pliku cookie ani identyfikatora.' },
        { p: 'Odsłony: każda strona aplikacji wysyła anonimową odsłonę: którą stronę otwarto (nigdy przestrzeń, kanał ani konto), jaka strona lub kampania Cię skierowała, czy odsłona pochodzi z zalogowanego konta oraz czy urządzenie to telefon, tablet czy komputer. Usługa dodaje kraj, region i miasto, które Cloudflare szacuje na podstawie połączenia. Odsłony nie zawierają adresu IP, pliku cookie ani identyfikatora, więc nie da się ich powiązać ze sobą ani z Tobą; liczymy je wyłącznie łącznie.' },
        { p: 'Na Twoim urządzeniu: Twoje przestrzenie (ich sekrety i listy członków), wiadomości, zmiany i pliki, które ma urządzenie, imiona, które widziało, klucz urządzenia i, po połączeniu, klucze Twojego konta (w IndexedDB); kto jest zalogowany, wybrany motyw, język i format zegara (w pamięci lokalnej); niewysłane szkice (tylko w tej karcie) oraz pliki aplikacji, aby otwierała się offline (w pamięci podręcznej service workera).' },
        { note: 'Bez reklam, pikseli śledzących, identyfikatorów odwiedzających i profilowania. Nie sprzedajemy danych.' },
      ],
    },
    {
      heading: '4. Podstawy prawne (RODO art. 6)',
      blocks: [
        { ul: [
          'Wykonanie usługi, o którą prosisz (art. 6 ust. 1 lit. b): logowanie, sprawdzanie listy przestrzeni, łączenie urządzeń członków, historia i przekaźnik przestrzeni Premium, Twój plan.',
          'Prawnie uzasadniony interes (art. 6 ust. 1 lit. f): bezpieczeństwo, zapobieganie nadużyciom, diagnostyka i raporty błędów, aby usługa działała, oraz łączne liczenie odsłon.',
          'Właściciele przestrzeni decydują, czyje adresy e-mail są na ich listach, i potrzebują własnej podstawy, aby zapraszać te osoby.',
        ] },
      ],
    },
    {
      heading: '5. Kto może zobaczyć Twoje dane',
      blocks: [
        { ul: [
          'Członkowie Twoich przestrzeni: Twoje imię, to, co tam piszesz, kiedy jesteś online oraz Twój adres IP, gdy Wasze urządzenia łączą się bezpośrednio. Członkowie widzą listę adresów e-mail przestrzeni.',
          'Cloudflare, które utrzymuje usługę: zaszyfrowaną treść, identyfikatory kont i urządzeń, metadane połączeń i adresy IP (dzienniki żądań, STUN, TURN); nie klucze do treści.',
          'Nasz zespół w CodeFusion Console (narzędziu administracyjnym operatora, również na Cloudflare): Twój identyfikator konta, daty pierwszego i ostatniego logowania oraz Twój plan; diagnostykę i raporty błędów.',
          'Dostawca, przez którego się logujesz, który wie, że zalogowano się do Peerly.',
        ] },
      ],
    },
    {
      heading: '6. Podmioty przetwarzające',
      blocks: [
        { ul: [
          'Cloudflare Workers i Durable Objects: logowanie, sesje, urządzenia, kanały przestrzeni, zaszyfrowana historia, plany.',
          'Cloudflare R2: zapieczętowane pliki przestrzeni Premium.',
          'Cloudflare STUN i TURN: ustalanie publicznego adresu urządzenia do połączeń bezpośrednich i przekazywanie połączeń kont Premium.',
          'Cloudflare Static Assets: serwowanie plików aplikacji.',
          'Cloudflare Workers Analytics Engine i D1, przez CodeFusion Console: diagnostyka, raporty błędów i liczba odsłon.',
          'Dostawcy tożsamości (Google, Microsoft, Apple lub Twojej organizacji): logowanie.',
        ] },
        { p: 'Cloudflare może przetwarzać dane poza Europejskim Obszarem Gospodarczym na podstawie standardowych klauzul umownych UE oraz programu EU–US Data Privacy Framework.' },
      ],
    },
    {
      heading: '7. Okres przechowywania',
      blocks: [
        { ul: [
          'Na Twoich urządzeniach: do opuszczenia przestrzeni, wyczyszczenia wiadomości w Ustawieniach → Pamięć lub wyczyszczenia danych przeglądarki. Wylogowanie je zachowuje na czas ponownego zalogowania.',
          'Sesje: do wygaśnięcia (30 dni bez używania) lub wylogowania. Połączone urządzenia: do ich odłączenia.',
          'Identyfikatory członków przestrzeni: dopóki przestrzeń jest używana; nowsza lista je zastępuje.',
          'Historia przestrzeni Premium: ostatnie 5000 zmian i jej zapieczętowane pliki, dopóki trwa Premium właściciela; oba są usuwane, gdy Premium się kończy.',
          'Identyfikator konta, urządzenia i plan: dopóki nie poprosisz o usunięcie konta.',
          'Raporty błędów: 30 dni; statystyki żądań, diagnostyki i odsłon: 3 miesiące; dzienniki żądań Cloudflare: 7 dni.',
        ] },
      ],
    },
    {
      heading: '8. Twoje prawa',
      blocks: [
        { p: `Możesz żądać dostępu do swoich danych, ich sprostowania lub usunięcia, ograniczenia przetwarzania i kopii (przenoszenia) oraz sprzeciwić się przetwarzaniu opartemu na prawnie uzasadnionym interesie. Napisz na ${m.privacyEmail} i podaj identyfikator konta z Ustawień: nie przechowujemy adresu e-mail, po którym moglibyśmy Cię odnaleźć. Możesz też złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych.` },
        { p: 'Nie możemy usunąć kopii Twoich wiadomości, które mają już urządzenia innych członków; poproś o to członków przestrzeni albo ją opuść i poproś właściciela o usunięcie Cię z listy.' },
      ],
    },
    {
      heading: '9. Pliki cookie i pamięć lokalna',
      blocks: [
        { p: 'Peerly ustawia jeden plik cookie, który przenosi Twoją sesję do naszych serwerów, jest czytelny tylko dla nich i obowiązuje każdorazowo przez 30 minut. Pamięć lokalna i IndexedDB przechowują to, co wymienia punkt 3. Wszystko to jest niezbędne do świadczenia usługi, o którą prosisz; nie ma plików cookie analitycznych ani reklamowych, więc nie prosimy o zgodę.' },
      ],
    },
    {
      heading: '10. Wiek',
      blocks: [{ p: `Peerly jest dla osób, które ukończyły ${m.minAge} lat.` }],
    },
    {
      heading: '11. Bezpieczeństwo',
      blocks: [
        { p: 'Treść jest szyfrowana od końca do końca kluczami, których nasze serwery nigdy nie otrzymują, a każda zmiana jest podpisana przez urządzenie, które ją wprowadziło; klucza urządzenia nie da się skopiować z przeglądarki. Połączenia z naszymi serwerami używają HTTPS. Blokuj swoje urządzenia i zatwierdzaj nowe tylko wtedy, gdy są Twoje: każdy, kto ma Twoje odblokowane urządzenie, może czytać Twoje przestrzenie.' },
      ],
    },
    {
      heading: '12. Zmiany',
      blocks: [{ p: 'Zaktualizujemy tę politykę, gdy Peerly zmieni zakres przetwarzanych danych, a datę ostatniej aktualizacji pokażemy na górze.' }],
    },
    {
      heading: '13. Kontakt',
      blocks: [{ p: `${m.controller} · ${m.privacyEmail}` }],
    },
  ],
}

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------

const termsEn: LegalDoc = {
  title: 'Terms of Service',
  updated: updatedLabel.en,
  intro: 'These Terms govern your use of Peerly. By using the app, you accept them.',
  sections: [
    { heading: '1. Acceptance', blocks: [{ p: 'Using Peerly means you accept these Terms and the Privacy Policy. If you disagree, do not use the app.' }] },
    { heading: '2. Age', blocks: [{ p: `You must be at least ${m.minAge}.` }] },
    { heading: '3. The service', blocks: [
      { p: 'Peerly connects the members of invite-only workspaces. Their devices pass what they write directly to each other, so without Premium a message reaches a member only while someone who has it is online.' },
      { p: 'Premium keeps the encrypted history and files of the workspaces you own on our servers (up to 5 GB of files each), so members get them whenever they come back, and lets your connections go through a relay when a direct one fails. Our team grants Premium for now, for the time it states, and may end it; we will tell you before charging for anything.' },
    ] },
    { heading: '4. Your account and devices', blocks: [
      { p: 'You sign in through a third-party identity provider and are responsible for your account and the devices you approve. Approve a new device only when it is yours: a linked device holds your account’s keys and can change the lists of workspaces you own.' },
    ] },
    { heading: '5. Workspaces', blocks: [
      { p: 'A workspace’s owner decides which email addresses may join and is responsible for the lawfulness of those invitations. An invite link carries the workspace’s key: share it only with the people the list names. Removing someone from the list stops them entering again; it cannot take back what their devices already received.' },
    ] },
    { heading: '6. Acceptable use', blocks: [
      { p: 'You agree not to use Peerly for:' },
      { ul: [
        'unlawful activity or violating others’ rights;',
        'illegal content, including child sexual abuse material (CSAM), which is strictly forbidden and reported to the authorities;',
        'harassment, threats or hate speech;',
        'distributing malware or spam, or attempts to get around safeguards, limits or other people’s access;',
        'infringing copyright or other third-party rights.',
      ] },
    ] },
    { heading: '7. Your content', blocks: [
      { p: 'You keep the rights to what you write and are responsible for it. Deleting a message removes it for members whose devices receive the deletion; copies made elsewhere stay where they are.' },
    ] },
    { heading: '8. Ownership and license', blocks: [{ p: 'Peerly’s code is open source under the MIT license.' }] },
    { heading: '9. Disclaimer of warranties', blocks: [{ p: 'The service is provided “as is”, without warranties of any kind, including as to availability, delivery of messages, security, or the conduct of other members.' }] },
    { heading: '10. Limitation of liability', blocks: [{ p: 'To the maximum extent permitted by law, we are not liable for damages arising from use of the app, including the content and conduct of other members. This does not exclude liability that cannot be excluded by law, such as towards consumers.' }] },
    { heading: '11. Reporting abuse and illegal content', blocks: [{ p: `Report illegal content or abuse to ${m.abuseEmail}. We cannot read workspaces’ content, but we act to the extent we can, including closing accounts and their access, and cooperate with the competent authorities.` }] },
    { heading: '12. Suspension', blocks: [{ p: 'We may suspend or close an account that breaks these Terms, and end its Premium.' }] },
    { heading: '13. Governing law', blocks: [{ p: `These Terms are governed by the law of ${m.governingLaw}. This does not affect mandatory consumer-protection rights in your country of residence.` }] },
    { heading: '14. Changes', blocks: [{ p: 'We may update these Terms; we will signal material changes and ask you to accept them again.' }] },
    { heading: '15. Contact', blocks: [{ p: `Contact: ${m.privacyEmail} · Abuse: ${m.abuseEmail}` }] },
  ],
}

const termsPl: LegalDoc = {
  title: 'Regulamin',
  updated: updatedLabel.pl,
  intro: 'Niniejszy Regulamin określa zasady korzystania z Peerly. Korzystając z aplikacji, akceptujesz te zasady.',
  sections: [
    { heading: '1. Akceptacja', blocks: [{ p: 'Korzystanie z Peerly oznacza akceptację niniejszego Regulaminu oraz Polityki prywatności. Jeśli się nie zgadzasz, nie korzystaj z aplikacji.' }] },
    { heading: '2. Wiek', blocks: [{ p: `Musisz mieć co najmniej ${m.minAge} lat.` }] },
    { heading: '3. Usługa', blocks: [
      { p: 'Peerly łączy członków przestrzeni dostępnych tylko dla zaproszonych. Ich urządzenia przekazują sobie bezpośrednio to, co piszą, więc bez Premium wiadomość dociera do członka tylko wtedy, gdy ktoś, kto ją ma, jest online.' },
      { p: 'Premium przechowuje na naszych serwerach zaszyfrowaną historię i pliki przestrzeni należących do Ciebie (do 5 GB plików w każdej), aby członkowie otrzymywali je po powrocie, i pozwala Twoim połączeniom iść przez przekaźnik, gdy bezpośrednie się nie uda. Na razie Premium przyznaje nasz zespół, na wskazany przez siebie czas, i może je zakończyć; zanim zaczniemy za cokolwiek pobierać opłaty, poinformujemy Cię o tym.' },
    ] },
    { heading: '4. Twoje konto i urządzenia', blocks: [
      { p: 'Logujesz się przez zewnętrznego dostawcę tożsamości i odpowiadasz za swoje konto oraz zatwierdzane urządzenia. Zatwierdzaj nowe urządzenie tylko wtedy, gdy jest Twoje: połączone urządzenie ma klucze Twojego konta i może zmieniać listy przestrzeni należących do Ciebie.' },
    ] },
    { heading: '5. Przestrzenie', blocks: [
      { p: 'Właściciel przestrzeni decyduje, które adresy e-mail mogą dołączyć, i odpowiada za zgodność tych zaproszeń z prawem. Link z zaproszeniem zawiera klucz przestrzeni: udostępniaj go tylko osobom z listy. Usunięcie kogoś z listy uniemożliwia mu ponowne wejście; nie odbiera tego, co jego urządzenia już otrzymały.' },
    ] },
    { heading: '6. Dozwolone korzystanie', blocks: [
      { p: 'Zobowiązujesz się nie używać Peerly do:' },
      { ul: [
        'działań niezgodnych z prawem lub naruszających prawa innych osób;',
        'treści nielegalnych, w tym materiałów przedstawiających wykorzystywanie seksualne dzieci (CSAM), które są bezwzględnie zakazane i zgłaszane organom;',
        'nękania, gróźb ani mowy nienawiści;',
        'rozpowszechniania złośliwego oprogramowania lub spamu ani prób obchodzenia zabezpieczeń, limitów lub dostępu innych osób;',
        'naruszania praw autorskich lub innych praw osób trzecich.',
      ] },
    ] },
    { heading: '7. Twoje treści', blocks: [
      { p: 'Zachowujesz prawa do tego, co piszesz, i za to odpowiadasz. Usunięcie wiadomości usuwa ją u członków, których urządzenia otrzymają to usunięcie; kopie wykonane gdzie indziej pozostają tam, gdzie są.' },
    ] },
    { heading: '8. Własność i licencja', blocks: [{ p: 'Kod Peerly jest udostępniany na otwartej licencji MIT.' }] },
    { heading: '9. Wyłączenie gwarancji', blocks: [{ p: 'Usługa dostarczana jest „tak, jak jest”, bez jakichkolwiek gwarancji, w tym co do dostępności, dostarczania wiadomości, bezpieczeństwa czy zachowania innych członków.' }] },
    { heading: '10. Ograniczenie odpowiedzialności', blocks: [{ p: 'W maksymalnym zakresie dozwolonym przez prawo nie ponosimy odpowiedzialności za szkody wynikające z korzystania z aplikacji, w tym za treści i zachowanie innych członków. Nie wyłącza to odpowiedzialności, której nie można wyłączyć zgodnie z prawem, np. wobec konsumentów.' }] },
    { heading: '11. Zgłaszanie nadużyć i treści nielegalnych', blocks: [{ p: `Nielegalne treści lub nadużycia zgłaszaj na ${m.abuseEmail}. Nie możemy odczytać treści przestrzeni, ale reagujemy w zakresie, w jakim to możliwe, w tym zamykając konta i ich dostęp, i współpracujemy z właściwymi organami.` }] },
    { heading: '12. Zawieszenie', blocks: [{ p: 'Możemy zawiesić lub zamknąć konto naruszające Regulamin i zakończyć jego Premium.' }] },
    { heading: '13. Prawo właściwe', blocks: [{ p: `Regulamin podlega prawu ${m.governingLaw}. Nie narusza to bezwzględnie obowiązujących praw konsumenta w kraju jego zamieszkania.` }] },
    { heading: '14. Zmiany', blocks: [{ p: 'Możemy aktualizować Regulamin; istotne zmiany zasygnalizujemy i poprosimy o ich ponowną akceptację.' }] },
    { heading: '15. Kontakt', blocks: [{ p: `Kontakt: ${m.privacyEmail} · Nadużycia: ${m.abuseEmail}` }] },
  ],
}

export const legalDocs: Record<'pl' | 'en', Record<LegalDocId, LegalDoc>> = {
  pl: { privacy: privacyPl, terms: termsPl },
  en: { privacy: privacyEn, terms: termsEn },
}
