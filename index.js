// index.js - Final fixed version with all commands working 100% and black embeds
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");
const math = require("mathjs");
const fs = require("fs");
const express = require("express");
const os = require("os");
const config = require("./config.js");

// ---------- File paths / persistence ----------
const teamPath = "./team.json";
const warningsPath = "./warnings.json";
const modlogPath = "./modlog.json";

function ensureFile(path, fallback = {}) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify(fallback, null, 2));
  return JSON.parse(fs.readFileSync(path, "utf8"));
}
function saveFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

let team = ensureFile(teamPath, {});
let warnings = ensureFile(warningsPath, {});
let modlogs = ensureFile(modlogPath, {});

// ---------- Express keep-alive ----------
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000, () => console.log("✅ KeepAlive server running"));

// ---------- Config ----------
const prefix = ",";

// ---------- Client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ---------- Helpers ----------
function parseTime(str) {
  const match = /^(\d+)(s|m|h|d)$/.exec(str);
  if (!match) return null;
  const n = Number(match[1]);
  const u = match[2];
  const mul = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * mul[u];
}
function msParse(str) {
  const m = /^(\d+)(s|m|h|d)?$/.exec(str);
  if (!m) return null;
  const num = Number(m[1]);
  const unit = m[2] || "m";
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * mult[unit];
}
function isSupport(member) {
  if (!member || !member.roles) return false;
  return member.roles.cache.has(config.supportRole);
}
function sendModLog(guild, embed) {
  try {
    const channelId = modlogs[guild.id];
    if (!channelId) return;
    const ch = guild.channels.cache.get(channelId);
    if (ch && ch.send) ch.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {}
}
function simpleEmbed(title, desc, color = "#000000") {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp();
}

// ---------- Status rotation ----------
const statuses = [
  "I put the 'pro' in procrastination",
  "Sarcasm is my love language",
  "I'm not arguing, I'm explaining why I'm right",
  "I'm silently correcting your grammar",
  "I love deadlines. I love the whooshing sound they make as they fly by"
];
let statusIndex = 0;
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  setInterval(() => {
    try {
      client.user.setActivity(statuses[statusIndex], { type: "WATCHING" });
    } catch (err) {
      console.error("Status error:", err);
    }
    statusIndex = (statusIndex + 1) % statuses.length;
  }, 30000);
});

// ---------- Snipe store ----------
const snipes = new Map();
client.on("messageDelete", (message) => {
  try {
    if (message.partial) return;
    if (!message.content && message.attachments.size === 0) return;
    snipes.set(message.channel.id, {
      content: message.content || null,
      authorTag: message.author ? message.author.tag : "Unknown",
      avatar: message.author ? message.author.displayAvatarURL() : null,
      image: message.attachments.first()?.proxyURL || null,
      time: Date.now()
    });
  } catch {}
});

// ---------- Command Handler ----------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = (args.shift() || "").toLowerCase();

  const ownerOnly = ["addaddy", "broadcast"];
  const supportRequired = [
    "calc","upi","ltc","usdt","vouch","remind","userinfo","stats","ping",
    "notify","clear","nuke","snipe","lock","unlock","slowmode","warn","kick","ban","unban",
    "mute","unmute","warnings","clearwarnings","serverinfo","say","poll","avatar","modlog","help"
  ];

  if (ownerOnly.includes(command) && message.author.id !== config.ownerId) {
    return message.reply("❌ You are not allowed to use that command.");
  }

  if (supportRequired.includes(command)) {
    if (message.guild) {
      if (!isSupport(message.member)) return message.reply("❌ Only support role can use this command.");
    } else {
      return message.reply("❌ This command can't be used in DMs.");
    }
  }

  // ---------------- Commands ----------------

  // CALC
  if (command === "calc") {
    const expr = args.join(" ");
    if (!expr) return message.reply("Usage: ,calc <expression>");
    try {
      const res = math.evaluate(expr);
      return message.reply({ embeds: [simpleEmbed("Calculator", `\`${expr}\` → **${res}**`)] });
    } catch {
      return message.reply("❌ Invalid expression.");
    }
  }

  // PAYMENT SHOW - upi, ltc, usdt
  if (["upi", "ltc", "usdt"].includes(command)) {
    const data = team[message.author.id];
    if (!data || !data[command]) return message.reply("❌ No saved address found.");
    const embed = new EmbedBuilder()
      .setTitle(`${command.toUpperCase()} Address`)
      .setDescription(`\`\`\`${data[command]}\`\`\``)
      .setColor("#000000")
      .setFooter({ text: `${message.guild ? message.guild.name : "DM"} | Made by Kai` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Copy Address").setStyle(ButtonStyle.Secondary).setCustomId(`copy-${command}-${message.author.id}`)
    );
    return message.reply({ embeds: [embed], components: [row] });
  }

  // VOUCH
  if (command === "vouch") {
    if (args.length < 2) return message.reply("Usage: ,vouch <product> <price>");
    const price = args.pop();
    const product = args.join(" ");
    const embed = new EmbedBuilder()
      .setDescription(`+rep ${message.author.id} | Legit Purchased **${product}** for **${price}**`)
      .setColor("#000000")
      .setFooter({ text: `${message.guild ? message.guild.name : "DM"} | Made by Kai` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Copy Vouch").setStyle(ButtonStyle.Secondary).setCustomId(`copy-vouch-${message.author.id}`)
    );
    return message.reply({ embeds: [embed], components: [row] });
  }

  // REMIND
  if (command === "remind") {
    const user = message.mentions.users.first();
    const delay = parseTime(args[0]);
    const msg = args.slice(1).join(" ");
    if (!user || !delay || !msg) return message.reply("Usage: ,remind @user 10s message");
    message.reply(`✅ Reminder set for ${user.tag} in ${args[0]}`);
    setTimeout(() => {
      user.send(`⏰ Reminder: ${msg}`).catch(() => {});
    }, delay);
    return;
  }

  // ADD ADDY
  if (command === "addaddy") {
    if (args.length < 3) return message.reply("Usage: ,addaddy USERID TYPE ADDRESS");
    const [userId, type, ...addrArr] = args;
    const address = addrArr.join(" ");
    const t = type.toLowerCase();
    if (!["upi", "ltc", "usdt"].includes(t)) return message.reply("Type must be upi/ltc/usdt");
    if (!team[userId]) team[userId] = {};
    team[userId][t] = address;
    saveFile(teamPath, team);
    return message.reply(`✅ Saved ${t.toUpperCase()} for <@${userId}>: \`${address}\``);
  }

  // SHOW ADDY
  if (command === "showaddy") {
    const id = args[0] || message.author.id;
    const data = team[id];
    if (!data) return message.reply("❌ No addresses for that user.");
    const lines = Object.entries(data).map(([k, v]) => `**${k.toUpperCase()}**: \`${v}\``).join("\n");
    return message.reply({ embeds: [new EmbedBuilder().setTitle(`Addresses for ${id}`).setDescription(lines).setColor("#000000")] });
  }

  // STATS
  if (command === "stats") {
    const embed = new EmbedBuilder()
      .setTitle("Bot Stats")
      .setColor("#000000")
      .setDescription(`**Guilds:** ${client.guilds.cache.size}\n**Users:** ${client.users.cache.size}\n**Uptime:** ${Math.floor(client.uptime / 1000 / 60)} mins\n**Memory:** ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n**Platform:** ${os.platform()} ${os.arch()}`)
      .setFooter({ text: "Made by Kai" });
    return message.reply({ embeds: [embed] });
  }

  // PING
  if (command === "ping") {
    const m = await message.reply("🏓 Pinging...");
    return m.edit(`🏓 Pong! Latency: ${m.createdTimestamp - message.createdTimestamp}ms | API: ${Math.round(client.ws.ping)}ms`);
  }

  // USERINFO
  if (command === "userinfo") {
    const user = message.mentions.users.first() || message.author;
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle(`User Info: ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setColor("#000000")
      .addFields(
        { name: "User ID", value: user.id, inline: true },
        { name: "Bot?", value: user.bot ? "Yes" : "No", inline: true },
        { name: "Status", value: member?.presence?.status || "offline", inline: true },
        { name: "Joined Server", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "N/A", inline: true },
        { name: "Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: `${message.guild ? message.guild.name : "DM"} | Made by Kai` });
    return message.reply({ embeds: [embed] });
  }

  // NOTIFY
  if (command === "notify") {
    const user = message.mentions.users.first();
    const msg = args.slice(1).join(" ");
    if (!user || !msg) return message.reply("Usage: ,notify @user message");
    const channelLink = message.channel.toString();
    user.send(`📢 You have been notified by **${message.author.tag}** in ${channelLink}:\n\n${msg}`).catch(() => {});
    return message.reply(`✅ ${user.tag} has been notified.`);
  }

  // BROADCAST
  if (command === "broadcast") {
    const msg = args.join(" ");
    if (!msg) return message.reply("Usage: ,broadcast message");
    message.guild.members.cache.forEach(member => {
      if (!member.user.bot) member.send(`📣 Broadcast from **${message.guild.name}**:\n\n${msg}`).catch(() => {});
    });
    return message.reply("✅ Broadcast sent to all members.");
  }

  // CLEAR
  if (command === "clear") {
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply("Usage: ,clear <1-100>");
    await message.channel.bulkDelete(amount, true).catch(() => message.reply("❌ Unable to delete messages."));
    const embed = simpleEmbed("Clear", `${message.author.tag} deleted ${amount} messages in ${message.channel}`);
    sendModLog(message.guild, embed);
    return message.reply(`✅ Deleted ${amount} messages`).then(msg => setTimeout(() => msg.delete().catch(() => {}), 3000));
  }

  // NUKE
  if (command === "nuke") {
    const channel = message.channel;
    const position = channel.position;
    const parent = channel.parent;
    await channel.clone().then(newCh => {
      newCh.setPosition(position).catch(() => {});
      newCh.setParent(parent).catch(() => {});
      channel.delete().catch(() => {});
    });
    return;
  }

  // LOCK
  if (command === "lock") {
    message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    return message.reply("🔒 Channel locked.");
  }

  // UNLOCK
  if (command === "unlock") {
    message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true }).catch(() => {});
    return message.reply("🔓 Channel unlocked.");
  }

  // SLOWMODE
  if (command === "slowmode") {
    const time = parseInt(args[0]);
    if (isNaN(time) || time < 0 || time > 21600) return message.reply("Usage: ,slowmode <seconds> (0–21600)");
    message.channel.setRateLimitPerUser(time).catch(() => message.reply("❌ Unable to set slowmode."));
    return message.reply(`✅ Slowmode set to ${time} seconds.`);
  }

  // WARN
  if (command === "warn") {
    const user = message.mentions.users.first();
    const reason = args.slice(1).join(" ") || "No reason provided.";
    if (!user) return message.reply("Usage: ,warn @user reason");
    if (!warnings[user.id]) warnings[user.id] = [];
    warnings[user.id].push({ reason, by: message.author.id, time: Date.now() });
    saveFile(warningsPath, warnings);
    sendModLog(message.guild, simpleEmbed("Warn", `${user.tag} warned by ${message.author.tag}\nReason: ${reason}`));
    return message.reply(`✅ ${user.tag} has been warned.`);
  }

  // WARNINGS
  if (command === "warnings") {
    const user = message.mentions.users.first() || message.author;
    const data = warnings[user.id] || [];
    if (!data.length) return message.reply("✅ No warnings.");
    const lines = data.map((w, i) => `**${i+1}.** ${w.reason} (by <@${w.by}>)`).join("\n");
    return message.reply({ embeds: [simpleEmbed("Warnings", lines)] });
  }

  // CLEARWARNINGS
  if (command === "clearwarnings") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,clearwarnings @user");
    warnings[user.id] = [];
    saveFile(warningsPath, warnings);
    return message.reply(`✅ Cleared all warnings for ${user.tag}`);
  }

  // KICK
  if (command === "kick") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,kick @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply("❌ I don't have permission to kick.");
    }
    await member.kick("Kicked by bot").catch(() => message.reply("❌ Failed to kick."));
    sendModLog(message.guild, simpleEmbed("Kick", `${user.tag} was kicked by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been kicked.`);
  }

  // BAN
  if (command === "ban") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,ban @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply("❌ I don't have permission to ban.");
    }
    await member.ban({ reason: "Banned by bot" }).catch(() => message.reply("❌ Failed to ban."));
    sendModLog(message.guild, simpleEmbed("Ban", `${user.tag} was banned by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been banned.`);
  }

  // UNBAN
  if (command === "unban") {
    const userId = args[0];
    if (!userId) return message.reply("Usage: ,unban USER_ID");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply("❌ I don't have permission to unban.");
    }
    await message.guild.bans.remove(userId).catch(() => message.reply("❌ Failed to unban."));
    return message.reply(`✅ Unbanned ${userId}`);
  }

  // MUTE
  if (command === "mute") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,mute @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.MuteMembers)) {
      return message.reply("❌ I don't have permission to mute.");
    }
    await member.voice.setMute(true, "Muted by bot").catch(() => message.reply("❌ Failed to mute."));
    sendModLog(message.guild, simpleEmbed("Mute", `${user.tag} was muted by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been muted.`);
  }

  // UNMUTE
  if (command === "unmute") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,unmute @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.MuteMembers)) {
      return message.reply("❌ I don't have permission to unmute.");
    }
    await member.voice.setMute(false, "Unmuted by bot").catch(() => message.reply("❌ Failed to unmute."));
    sendModLog(message.guild, simpleEmbed("Unmute", `${user.tag} was unmuted by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been unmuted.`);
  }

  // MODLOG
  if (command === "modlog") {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply("Usage: ,modlog #channel");
    modlogs[message.guild.id] = ch.id;
    saveFile(modlogPath, modlogs);
    return message.reply(`✅ Modlog set to ${ch.name}`);
  }

  // SERVERINFO
  if (command === "serverinfo") {
    const g = message.guild;
    const embed = new EmbedBuilder()
      .setTitle("Server Info")
      .setDescription(g.description || "No description")
      .setColor("#000000")
      .addFields(
        { name: "Name", value: g.name, inline: true },
        { name: "Members", value: `${g.memberCount}`, inline: true },
        { name: "Owner", value: `${g.ownerId}`, inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // SAY
  if (command === "say") {
    const msg = args.join(" ");
    if (!msg) return message.reply("Usage: ,say message");
    return message.channel.send(msg);
  }

  // POLL
  if (command === "poll") {
    const question = args.join(" ");
    if (!question) return message.reply("Usage: ,poll question");
    const embed = new EmbedBuilder().setTitle("Poll").setDescription(question).setColor("#000000");
    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react("✅");
    await msg.react("❌");
    return;
  }

  // AVATAR
  if (command === "avatar") {
    const user = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`${user.tag}'s Avatar`)
      .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setColor("#000000");
    return message.reply({ embeds: [embed] });
  }

  // HELP
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("Assistant Bot Commands")
      .setColor("#000000")
      .setDescription("Prefix: `,` • Support role required for most commands.")
      .addFields(
        { name: "Payments", value: ",upi ,ltc ,usdt (show saved)", inline: false },
        { name: "Utility", value: ",calc ,remind ,vouch ,notify ,snipe ,say ,poll ,avatar", inline: false },
        { name: "Info", value: ",stats ,ping ,userinfo ,serverinfo", inline: false },
        { name: "Moderation", value: ",clear ,nuke ,lock ,unlock ,slowmode ,warn ,warnings ,clearwarnings ,kick ,ban ,unban ,mute ,unmute ,modlog", inline: false },
        { name: "Owner", value: ",addaddy ,broadcast", inline: false }
      )
      .setFooter({ text: "Made by Kai" });
    return message.reply({ embeds: [embed] });
  }

  // SNIPE
  if (command === "snipe") {
    const data = snipes.get(message.channel.id);
    if (!data) return message.reply("❌ No message to snipe.");
    const embed = new EmbedBuilder()
      .setTitle("Sniped Message")
      .setDescription(data.content || "No text content")
      .setAuthor({ name: data.authorTag, iconURL: data.avatar })
      .setImage(data.image || null)
      .setFooter({ text: "Deleted message" })
      .setColor("#000000");
    return message.reply({ embeds: [embed] });
  }
});

// ---------- Interaction Handler ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("copy-")) {
    const teamData = ensureFile(teamPath, {});
    const parts = interaction.customId.split("-");
    const key = parts[1];
    const userId = parts[2];
    let content = null;

    if (key === "vouch") {
      content = interaction.message.embeds[0]?.description || null;
    } else {
      const userData = teamData[userId] || {};
      content = userData[key] || null;
    }

    if (!content) return interaction.reply({ content: "❌ No data found to copy.", ephemeral: true });
    return interaction.reply({ content, ephemeral: true });
  }
});

// ---------- Login ----------
client.login(process.env.TOKEN);
