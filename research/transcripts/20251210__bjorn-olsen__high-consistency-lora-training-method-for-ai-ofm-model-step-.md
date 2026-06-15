---
title: "High Consistency LoRA Training Method for AI OFM Model (Step-by-Step)"
channel: "Bjorn Olsen"
video_id: "utttzYpngWk"
url: "https://www.youtube.com/watch?v=utttzYpngWk"
upload_date: "20251210"
duration: "6:39"
transcript_source: "Apify (pintostudio youtube-transcript-scraper)"
fetched_with: "scripts/yt_transcript.py"
---

# High Consistency LoRA Training Method for AI OFM Model (Step-by-Step)

**Channel:** Bjorn Olsen
**URL:** https://www.youtube.com/watch?v=utttzYpngWk
**Uploaded:** 20251210 — **Duration:** 6:39
**Source:** Apify (pintostudio youtube-transcript-scraper)

---

[0:00](https://www.youtube.com/watch?v=utttzYpngWk&t=0s) And once all that's said and done, you're going to end up with something like this, like this, like this, this, and this. First, I'll show you how to train a lura. Now, to train this lura, we're going to be using the following. We're going to be setting up a pod within run pod. You'll just create an account, add credit, and this essentially just allows you to hire their GPUs, hire their hardware, and do all this over the cloud. So, that way you aren't bound by the specs of your computer, but you can just do this from anywhere. combination with our 26 training images that we compiled on the last video solely using Google Gemini.

[0:32](https://www.youtube.com/watch?v=utttzYpngWk&t=32s) Now, we'll begin by setting up the pod in the following manner. You're going to click on pods. Scroll down, select the GPU. For this, we're going to select the H100 SXM. You not need any more or less than that. Just select that. Then, we're going to scroll down here where it says pod template. We're going to go change template. Once that's open, we're going to click on the search bar here and type in diffusion pipe upon which three options are going to pop down below. We're going to be using this one on the left here that says allin-one at the end. Once we've selected that, we're going to select the number of GPUs just

[1:03](https://www.youtube.com/watch?v=utttzYpngWk&t=63s) to one. You can use more if you want it to go quicker. But the Laura training will take around 15 minutes, so it doesn't matter. You can just stick with one. But anyway, the other thing we're going to do, which I just forgot, is up on pod template. We're going to select edit and we're just going to add some volume to our volume disc. So, we'll just go 100 gig to be safe. This is just to store all of the models, store all of the training images, etc. I know 100 gig is too much, but oh well. And then once all that's done, you're going to click on deploy on demand. And this is going

[1:34](https://www.youtube.com/watch?v=utttzYpngWk&t=94s) to take about 10 minutes or so, so go make a coffee, come back, and I'm sure we'll be ready. Okay, so that's finally loaded in. So now we'll click on Jupyter Lab. This is where it's all going to happen. We're going to be running all of this within the terminal inside Jupyter Lab via commands. The very first thing we're going to do is we're going to upload our training image data set to this folder here on the left titled image data set here. Once inside, we're going to upload all the images just via the upload button. Simply going to highlight all the images

[2:05](https://www.youtube.com/watch?v=utttzYpngWk&t=125s) and upload them. Okay, once that's done, we're going to go back to the main folder directory. Now, we're going to boot up the terminal simply by clicking on the tab with launcher, selecting terminal, waiting for that to boot up, and then we're going to run the following commands to get this thing started. First one's going to be bash. Enter. And then we're going to be writing this bash interactive start_raining.sh. Enter again. And then it's literally just going to prompt us and run us through the whole process. So, the model we're going to want to use is SDXL,

[2:37](https://www.youtube.com/watch?v=utttzYpngWk&t=157s) stable diffusion. We'll go two enter. Then it will ask do we want to caption the images? And yes, we'll say one images only. Enter. Trigger word we're going to be using for the image captions is the identity token. So you want this to be one word. This will be the name of the model. Now I see a lot of people using two words. Say it might be Mandy Jane with two words. That will be two identity tokens. And some models will not work well with that. So to be safe, we're just going to use one word as the

[3:08](https://www.youtube.com/watch?v=utttzYpngWk&t=188s) trigger word, which is the identity token. So for our one, we're just going to go Sarah with weird spelling and go enter. Now, what this is going to do is caption all of the images inside the training data set folder in a way that can be read the best by the Laura model when you go to generate content with it. And then it will add the trigger word at the start of each caption. All right, so that's done. And then we're going to do a couple of things to manually edit the parameters. So the way we're going to do that is by clicking on this folder here, diffusion pipe, clicking on examples,

[3:42](https://www.youtube.com/watch?v=utttzYpngWk&t=222s) and we're going to be editing these two files here. So the first one we're going to edit is this one. You're going to double click on it, and it will show the following, which is a bunch of parameters. Now, we're actually going to replace all of that with this, which has just been copied and pasted from that guide I was talking about at the start of the video. Now once that's done, we're going to exit and make sure to save on the way out. Then we'll open up the data set tol highlight everything and replace this with the following. Once the following has been put in there, minus this part which has just been directly copied and paste from the

[4:12](https://www.youtube.com/watch?v=utttzYpngWk&t=252s) guide, we will exit this and also make sure to save on the way out. Now we can continue to begin the training. Have you finished configuring the settings? Yes. Do they look correct? Yes. Have you reviewed the image captions and ready to proceed? Yes. Now it's going to start training. Now this actually just happened and an error popped up and I didn't want to remove this for the video because I just want to give you a heads up. If you go to begin the Laura model training and you see it pause followed by an error, it is often due to some little character being accidentally

[4:43](https://www.youtube.com/watch?v=utttzYpngWk&t=283s) added or subtracted from one of these two TOML files. To patch this up, you'll simply open the TOML file that gets referenced and it will normally tell you exactly where the problem is. So you'll open the relevant file, remove or add the character that's needed, and then you'll actually just restart this process again just by entering the following commands that we wrote at the start. All right, so after some time, I've traced it back to this simple error of having this being wrapped over to a

[5:13](https://www.youtube.com/watch?v=utttzYpngWk&t=313s) second line when it should be pasted right next to the checkpoint path equal sign. Now, this has likely been caused from directly copying and pasting from the guide as is. So, if you come across any errors, just note that it's going to be something very simple like this. And to simply go over it and make sure that everything is in the right line and not wrapped over to two spaces cuz that one simple error can just hold up the whole thing as you can see. All right, now we can get back to it. We'll just restart. I won't make you go through that. So, we'll just resume from where we left off. All right, so training is finished.

[5:45](https://www.youtube.com/watch?v=utttzYpngWk&t=345s) We're going to go ahead and save each of the Laura models. There will be one Laura model saved for each epoch that was factored into the parameters which will be five. So there'll be five different epochs which you will find in the output folder. SCXL Laura the dates. So here's the five different epochs here. Now I've said in a different video before. What tends to happen with these epochs is that the lower ones tend to underfit the model and the high ones tend to overfit. So the sweet spot is usually about three or four. But just in

[6:17](https://www.youtube.com/watch?v=utttzYpngWk&t=377s) case, you're going to download each one to your computer simply by opening it, right clicking on it, and then downloading. Now, they're fairly sizable, so this will take some time. So, I'll just go ahead and skip to the end once I've downloaded all five to the computer. And once all that's said and done, you're going to end up with something like this.
