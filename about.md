# Haste — code.tk.sg

A pastebin for sharing code snippets, run by [Tinkertanker](https://tinkertanker.com).

## Basic Usage

Paste your code, click "Save" and copy the URL.
Send that URL to someone and they'll see your code.

To make a new entry, click "New" (or hit `Ctrl + N`)

## From the Console

`cat something | curl -X POST -d @- https://code.tk.sg/documents`

## Duration

Pastes expire after 1 year of inactivity.

## Open Source

* [haste-server](https://github.com/tinkertanker/code.tk.sg) (this instance)
* Based on [zneix/haste-server](https://github.com/zneix/haste-server)

## Credits

Project continued by zneix <zzneix@gmail.com>
Original Code by John Crepezzi <john.crepezzi@gmail.com>
Key Design by Brian Dawson <bridawson@gmail.com>
