# Tinkercademy

This Haste server is brought to you by [Tinkercademy](https://tinkercademy.com).

This is our deployment fork of Haste, created by John Crepezzi and continued by
zneix and other contributors. Tinkercademy maintains this service and its
deployment adaptations, not the original Haste application.

# Haste — adapted upstream introduction and usage

The introduction and usage sections below are adapted from Haste's original
documentation. First-person descriptions are the upstream authors' words.
The example service URL has been changed to code.tk.sg. The console-client
instructions are inherited guidance, not clients maintained by Tinkercademy.

Sharing code is a good thing, and it should be _really_ easy to do it.
A lot of times, I want to show you something I'm seeing - and that's where we
use pastebins.

Haste is the prettiest, easiest to use pastebin ever made.

## Basic Usage

Type what you want me to see, click "Save", and then copy the URL.  Send that
URL to someone and they'll see what you see.

To make a new entry, click "New" (or type 'control + n')

## From the Console

Most of the time I want to show you some text, it's coming from my current
console session.  We should make it really easy to take code from the console
and send it to people.

`cat something | haste` # https://code.tk.sg/1238193

You can even take this a step further, and cut out the last step of copying the
URL with:

* osx: `cat something | haste | pbcopy`
* linux: `cat something | haste | xsel`
* windows: check out [WinHaste](https://github.com/ajryan/WinHaste)

After running that, the STDOUT output of `cat something` will show up at a URL
which has been conveniently copied to your clipboard.

That's all there is to that, and you can install it with `gem install haste`
right now.
  * osx: you will need to have an up to date version of Xcode
  * linux: you will need to have rubygems and ruby-devel installed

# code.tk.sg service policies — Tinkercademy

The following duration and privacy policies apply to our service, not to all
Haste deployments.

## Duration

Pastes will stay for 1 year from their last view.  They may be removed earlier
and without notice.

## Privacy

While the contents of code.tk.sg are not directly crawled by any search robot
that obeys "robots.txt", there should be no great expectation of privacy.  Post
things at your own risk. Not responsible for any loss of data or removed
pastes.

# Source and credits

Haste is open-source software under the MIT licence. This fork preserves the
original authors' notices; third-party components retain their own licences.

* [Original Haste client](https://github.com/seejohnrun/haste-client)
* [Upstream haste-server, continued by zneix](https://github.com/zneix/haste-server)
* [Tinkercademy's deployment fork](https://github.com/tinkertanker/code.tk.sg)

## Credits

Code by John Crepezzi <john.crepezzi@gmail.com>
Key Design by Brian Dawson <bridawson@gmail.com>

haste-server continued by zneix and contributors.
code.tk.sg deployment, branding adaptations, and service policies maintained by
Tinkercademy.
