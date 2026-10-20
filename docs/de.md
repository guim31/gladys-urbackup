# UrBackup

[UrBackup](https://www.urbackup.org/) ist ein freies Client-Server-
Sicherungssystem: Ein Server sichert die Dateien (und unter Windows die
Festplatten-Images) der Computer deines Zuhauses oder Büros. Diese
Integration holt die Clients eines UrBackup-Servers in Gladys: Jeder Client
(ein gesicherter Computer) wird ein Gerät mit seinem Zustand, ob er online
ist, seinen letzten Datei- und Image-Sicherungen, der laufenden Sicherung und
ihrem Fortschritt. Szenen können reagieren, wenn **irgendeine** Sicherung
gelingt, fehlschlägt oder überfällig ist, ein Dashboard-Widget listet die
fehlgeschlagenen Clients zuerst, und eine Szene kann eine inkrementelle
Dateisicherung starten.

Getestet mit einem echten UrBackup-Server 2.5 (Docker-Image
`uroni/urbackup-server` 2.5.37, Client `uroni/urbackup-client` 2.5.31):
Anmeldung mit und ohne Benutzer, eine Sicherung, die gelingt, eine, die
fehlschlägt, eine aus der Integration gestartete Sicherung, ein Client
offline. Noch nicht mit einem echten Gladys getestet: Rückmeldungen gern über
[die Issues](https://github.com/guim31/gladys-urbackup/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Einen UrBackup-Server, erreichbar vom Gladys-Rechner, mit seiner
  Weboberfläche (standardmäßig Port 55414).
- Einen Benutzer dieser Weboberfläche (**Einstellungen → Benutzer**): den
  Admin, oder besser einen eigenen Benutzer mit den Rechten `status`,
  `progress`, `lastacts`, `logs` und `start_backup` (das letzte nur, um
  Sicherungen aus Gladys zu starten). Ein Server ganz ohne Benutzer nimmt
  jeden an: Die Integration funktioniert dann ohne Passwort, aber schütze
  deinen Server.

Die Integration liest UrBackup standardmäßig alle 5 Minuten (alle 30 Sekunden
während einer Sicherung): drei leichte Anfragen in deinem eigenen Netz.

## Erste Schritte

### 1. Den UrBackup-Server vorbereiten

In der Weboberfläche von UrBackup, **Einstellungen → Benutzer → Benutzer
erstellen**: ein Name (zum Beispiel `gladys`), ein Passwort und die oben
genannten Rechte. Mit dem Admin-Konto ist nichts zu tun.

### 2. Die Integration konfigurieren

In Gladys, **Integrationen → UrBackup → Konfiguration**:

- **UrBackup-Adresse**: zum Beispiel `http://192.168.1.2:55414`. Eine bloße
  Adresse (`192.168.1.2`) bedeutet `http://` auf Port 55414; eine aus dem
  Browser kopierte Adresse geht auch. Hinter einem Reverse-Proxy dessen
  `https://`-Adresse (mit gültigem Zertifikat).
- **Benutzername** und **Passwort**: der Benutzer der Weboberfläche.
- **Aktualisierungsintervall**: 1, 5 (Standard) oder 15 Minuten.
- **Überfällig nach**: wann ein Client ohne erfolgreiche Sicherung überfällig
  wird. _Automatisch_ (Standard) folgt UrBackup: Ein Client ist überfällig,
  wenn UrBackup seine Dateisicherungen nicht mehr als OK markiert (keine
  Sicherung im Intervall seiner Einstellungen, standardmäßig dem der
  inkrementellen). Oder eine feste Zeit, von 12 Stunden bis zu einer Woche,
  seit seiner letzten erfolgreichen Sicherung, Datei oder Image.
- **Starten von Sicherungen erlauben**: lässt die Szenenaktion
  „Dateisicherung starten“ funktionieren. Schalte es ab, wenn niemand aus
  Gladys eine Sicherung starten soll.
- **Sprache der Namen**: Sprache der Funktionsnamen, der Zustände und der
  Szenen-Ergebnisse.

**Verbindung testen** liest UrBackup und fasst zusammen: die Zahl der Clients,
online, fehlgeschlagen und überfällig.

### 3. Die Clients anlegen

Lege im Tab **Entdecken** die Clients an, denen du folgen willst, und das
Gerät „UrBackup“ für den Server. Die Szenen-Auslöser funktionieren für alle
Clients, angelegt oder nicht.

## Die Geräte

Jeder Client:

| Funktion                             | Wert                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| Zustand                              | OK, Fehlgeschlagen, Überfällig, Läuft oder Keine Sicherung |
| Online                               | 1, wenn der Client mit dem Server verbunden ist            |
| Letzte Dateisicherung                | Tag/Monat Stunden:Minuten, „-“ wenn keine                  |
| Stunden seit letzter Dateisicherung  | in Stunden                                                 |
| Letzte Image-Sicherung               | Tag/Monat Stunden:Minuten, „-“ wenn keine                  |
| Stunden seit letzter Image-Sicherung | in Stunden                                                 |
| Sicherung läuft                      | 1, solange eine Sicherung dieses Clients läuft             |
| Fortschritt                          | in %, der laufenden Sicherung                              |
| Fehler der letzten Sicherung         | Fehler im Protokoll seiner letzten Sicherung               |

Das Gerät „UrBackup“ für den Server zählt:

- **Clients online**;
- **Laufende Sicherungen**;
- **Fehlgeschlagene Clients**;
- **Überfällige Clients**.

Eine Sicherung „schlägt fehl“, wenn ihr Protokoll Fehler enthält: eine
Sicherung, die UrBackup nicht abschließen konnte, oder die mit Fehlern endete.
Ein Client offline bekommt in Gladys das Abzeichen „nicht erreichbar“. Der
Zustand zeigt zuerst, was Aufmerksamkeit braucht: Ein fehlgeschlagener Client
zeigt „Fehlgeschlagen“, auch wenn er zugleich überfällig ist.

## Dashboard

Das Widget **UrBackup** zeigt die Zahl der Clients fehlgeschlagen, überfällig
und online, dann eine Zeile pro Client: fehlgeschlagene zuerst, dann
überfällige, laufende, ohne Sicherung, OK, mit der letzten Sicherung (oder dem
Fortschritt der laufenden); ein OK-Client offline ist grau. Standardmäßig alle
Clients, oder die in seinen Einstellungen gewählten. Die Schaltfläche
**Aktualisieren** liest UrBackup neu.

## Szenen

### Auslöser

- **Eine Sicherung gelingt**: Eine Sicherung (Dateien oder Image) endet ohne
  Fehler. Informationen: Client, Art (Dateien, Image), Dauer (Minuten),
  übertragene Größe.
- **Eine Sicherung schlägt fehl**: Eine Sicherung endet mit Fehlern im
  Protokoll. Informationen: Client, Art, erster Fehler, Fehler.
- **Ein Client ist überfällig**: Ein Client hatte länger als die Zeit
  „Überfällig nach“ keine erfolgreiche Sicherung. Einmal, dann wieder nach
  einem neuen Erfolg. Informationen: Client, Stunden seit letztem Erfolg,
  letzter Erfolg.

Jeder Auslöser lässt sich auf einige Clients beschränken (leer: alle).

### Aktionen

- **Zustand eines Clients**: liest den Zustand eines Clients für die nächsten
  Aktionen: fehlgeschlagen, überfällig, online, der Zustand in Worten, der
  Client, der letzte Erfolg, Stunden seit letztem Erfolg (-1, wenn keiner),
  und ein fertiger Satz („laptop-anna: Fehlgeschlagen, letzte Sicherung 18.10.
  02:05.“).
- **Dateisicherung starten**: startet jetzt eine inkrementelle Dateisicherung
  des Clients. Abgelehnt, wenn „Starten von Sicherungen erlauben“ abgeschaltet
  ist, oder von UrBackup, wenn der Client offline ist.

### Szenen-Ideen

- **Eine Sicherung schlägt fehl** → eine Nachricht mit dem Client und seinem
  ersten Fehler schicken, aus den Informationen des Auslösers.
- **Ein Client ist überfällig** → mit dem Client und den Stunden seit seinem
  letzten Erfolg benachrichtigen: Der Laptop war seit Tagen nicht an.
- Jeden Sonntag um 10:00 → **Zustand eines Clients** → den Satz schicken;
  oder um 19:00 eine Dateisicherung des Bürorechners mit **Dateisicherung
  starten** starten.

## Fehlerbehebung

- **„UrBackup antwortet nicht“**: Prüfe Adresse und Port vom Gladys-Rechner
  aus (`http://…:55414`, der Port der Weboberfläche, nicht 55413 oder 55415).
- **„Benutzername oder Passwort von UrBackup abgelehnt“**: Gib sie erneut
  ein; es sind die eines Benutzers der Weboberfläche.
- **„diesem UrBackup-Benutzer fehlt ein Recht“**: Gib dem Benutzer die Rechte
  `status`, `progress`, `lastacts`, `logs` (und `start_backup`). Ohne `logs`
  werden die Zustände angezeigt, aber keine gelungene oder fehlgeschlagene
  Sicherung gemeldet.
- **„UrBackup hat die Sicherung nicht gestartet“**: Der Client ist offline,
  oder eine Sicherung von ihm läuft schon.
- **„UrBackup aktualisiert seine Datenbank“**: nach einem Update von UrBackup;
  warte, bis es fertig ist.
- **Ein Client wird nie überfällig**: In _Automatisch_ ist ein Client mit
  abgeschalteten Dateisicherungen, oder nie gesichert, nicht überfällig; wähle
  eine feste Zeit für die Image-Sicherungen.
- Für mehr Details setze die Variable `LOG_LEVEL` der Integration auf `debug`.

## Grenzen

- Ein UrBackup-Server pro Integration.
- Nach einem Ausfall werden nur die Sicherungen der letzten 24 Stunden
  gemeldet; ältere werden still erfasst.
- Eine Sicherung ist an ihrem Ende bekannt, über ihr Protokoll: Die Auslöser
  kommen beim nächsten Lesen (standardmäßig 5 Minuten).
- Die Integration überwacht die Sicherungen und startet, wenn erlaubt,
  inkrementelle Dateisicherungen; wiederherstellen, löschen oder
  konfigurieren kann sie nichts.
- HTTPS nur mit einem von einer bekannten Stelle signierten Zertifikat (ein
  Reverse-Proxy).
- Nicht mit UrBackup verbunden. Melde ein Problem oder eine Idee über
  [die Issues](https://github.com/guim31/gladys-urbackup/issues).
