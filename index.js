/*
 Immersive Music Dock

 GitHub Edition

*/

const IMD_ID =
"immersive_music_dock";



const DEFAULT_SETTINGS = {

    enabled:true,

    autoMusic:true,

    autoNext:true,

    hideUnits:true,


    volume:0.7,


    bindThemes:[],


    backupMusic:[

        "",
        "",
        "",
        "",
        ""

    ],


    musicApi:""

};





let imdSettings;


let imdAudio =
new Audio();



let currentSong=null;


let musicQueue=[];


let musicIndex=0;






// ==========================
// 获取ST环境
// ==========================


function getSTContext(){

    return SillyTavern.getContext();

}







// ==========================
// 初始化设置
// ==========================


function loadIMDSettings(){


    const context =
    getSTContext();



    if(
        !context.extensionSettings[IMD_ID]
    ){


        context.extensionSettings[IMD_ID]
        =
        structuredClone(
            DEFAULT_SETTINGS
        );


        context.saveSettingsDebounced();


    }



    imdSettings =
    Object.assign(

        structuredClone(DEFAULT_SETTINGS),

        context.extensionSettings[IMD_ID]

    );



    context.extensionSettings[IMD_ID]
    =
    imdSettings;



}








// ==========================
// 主启动
// ==========================


jQuery(async()=>{


    loadIMDSettings();



    const context =
    getSTContext();



    const {

        eventSource,

        event_types

    } = context;





    eventSource.on(

        event_types.APP_READY,

        ()=>{


            createMusicDock();


            updateAvatars();


        }

    );






    if(event_types.CHAT_CHANGED){


        eventSource.on(

            event_types.CHAT_CHANGED,

            ()=>{


                updateAvatars();



                if(
                    imdSettings.autoMusic
                ){


                    findMusic();


                }


            }

        );


    }





    if(event_types.CHARACTER_MESSAGE_RENDERED){


        eventSource.on(

            event_types.CHARACTER_MESSAGE_RENDERED,

            ()=>{


                if(
                    imdSettings.hideUnits
                ){

                    hideUnits();

                }


            }

        );

    }



});









// ==========================
// 创建音乐栏
// ==========================


function createMusicDock(){



    if(
        $("#immersive-music-dock").length
    )

    return;




    const html = `


<div id="immersive-music-dock">


    <div id="imd-avatar-box">


        <img
        id="imd-char-avatar"
        >



        <img
        id="imd-user-avatar"
        >


    </div>



    <div id="imd-song-box">


        <div id="imd-title">

        Immersive Music Dock

        </div>



        <div id="imd-artist">

        --

        </div>


    </div>




    <button
    id="imd-pause">


    Ⅱ


    </button>



</div>


`;




    $("#nonQRFormItems")
    .prepend(html);



    bindMusicEvents();



}







// ==========================
// 音乐栏按钮
// ==========================


function bindMusicEvents(){



    $("#imd-char-avatar")
    .on(

        "click",

        ()=>{

            previousSong();

        }

    );





    $("#imd-user-avatar")
    .on(

        "click",

        ()=>{

            nextSong();

        }

    );






    $("#imd-pause")
    .on(

        "click",

        ()=>{


            if(
                imdAudio.paused
            ){

                imdAudio.play()
                .catch(()=>{});


            }

            else{


                imdAudio.pause();


            }



        }

    );



}









// ==========================
// 更新头像
// ==========================


function updateAvatars(){



    const context =
    getSTContext();




    const char =

    context.characters?.[

        context.characterId

    ];





    if(char?.avatar){


        $("#imd-char-avatar")
        .attr(

            "src",

            char.avatar

        );


    }





    const userAvatar =

    context.power_user
    ?.persona_image
    ||
    "";





    if(userAvatar){


        $("#imd-user-avatar")
        .attr(

            "src",

            userAvatar

        );


    }



}







// ==========================
// 播放歌曲
// ==========================


function playSong(song){



    if(
        !song?.url
    )

    return;




    currentSong=song;



    imdAudio.src =
    song.url;



    imdAudio.volume =
    imdSettings.volume;




    imdAudio.play()
    .catch(()=>{});





    $("#imd-title")
    .text(

        song.title
        ||
        "Unknown"

    );



    $("#imd-artist")
    .text(

        song.artist
        ||
        ""

    );



}







// ==========================
// 下一首
// ==========================


function nextSong(){


    if(
        !musicQueue.length
    )

    return;



    musicIndex++;



    if(
        musicIndex>=musicQueue.length
    )

    musicIndex=0;



    playSong(

        musicQueue[musicIndex]

    );


}







// ==========================
// 上一首
// ==========================


function previousSong(){



    if(
        !musicQueue.length
    )

    return;



    musicIndex--;



    if(
        musicIndex<0
    )

    musicIndex =
    musicQueue.length-1;



    playSong(

        musicQueue[musicIndex]

    );



}






// ==========================
// 自动下一首
// ==========================


imdAudio.onended=()=>{


    if(
        imdSettings.autoNext
    ){


        if(
            musicQueue.length>1
        ){


            nextSong();


        }

        else{


            findMusic();


        }


    }


};
// ==========================
// 自动寻找音乐
// ==========================


async function findMusic(){


    try{


        const keyword =
        generateMusicKeyword();



        if(!keyword)

        return;



        console.log(
            "[IMD] Search:",
            keyword
        );



        // 优先用户API


        if(
            imdSettings.musicApi
        ){


            const apiResult =
            await searchCustomAPI(
                keyword
            );



            if(apiResult){


                musicQueue=[

                    apiResult

                ];


                musicIndex=0;


                playSong(
                    apiResult
                );


                return;


            }


        }




        // API失败

        // 使用备用音乐


        playBackupMusic();



    }

    catch(e){


        console.error(
            "[IMD] Music error",
            e
        );


        playBackupMusic();


    }



}








// ==========================
// 读取剧情生成关键词
// ==========================


function generateMusicKeyword(){



    const context =
    getSTContext();



    let text="";




    // 当前角色


    const character =

    context.characters?.[

        context.characterId

    ];




    if(character){



        text +=

        character.name
        +
        " ";



        text +=

        character.description
        ||
        "";



        text +=

        character.personality
        ||
        "";



        text +=

        character.first_mes
        ||
        "";



    }







    // 最近聊天


    if(
        context.chat
    ){



        const recent =

        context.chat.slice(-8);




        for(
            const msg of recent
        ){



            if(msg.mes)

            text +=

            " "
            +
            msg.mes;



        }



    }






    return analyzeMood(text);



}








// ==========================
// 氛围分析
// ==========================


function analyzeMood(text){



    const moods={



        "悲伤":[

            "死亡",
            "离开",
            "失去",
            "眼泪",
            "哭",
            "痛苦"

        ],




        "治愈":[

            "温柔",
            "陪伴",
            "安心",
            "温暖"

        ],




        "黑暗":[

            "黑夜",
            "血",
            "恶魔",
            "恐惧",
            "深渊"

        ],




        "浪漫":[

            "爱",
            "喜欢",
            "拥抱",
            "心动"

        ],




        "战斗":[

            "战争",
            "敌人",
            "攻击",
            "剑"

        ],




        "幻想":[

            "魔法",
            "森林",
            "梦",
            "异世界"

        ],




        "孤独":[

            "孤独",
            "寂寞",
            "一个人"

        ]



    };





    let result=[];





    for(
        const mood in moods
    ){



        for(
            const word of moods[mood]
        ){



            if(
                text.includes(word)
            ){



                result.push(
                    mood
                );


                break;


            }



        }



    }






    if(
        result.length===0
    ){


        result.push(
            "fantasy ambient"
        );


    }





    return result.join(" ");



}









// ==========================
// 自定义音乐API
// ==========================


async function searchCustomAPI(keyword){



    try{



        const response =

        await fetch(

            imdSettings.musicApi,

            {

                method:"POST",


                headers:{


                    "Content-Type":
                    "application/json"


                },


                body:

                JSON.stringify({

                    keyword:keyword


                })

            }


        );





        const data =

        await response.json();






        if(
            data?.url
        ){



            return {


                title:

                data.title
                ||
                "Unknown",



                artist:

                data.artist
                ||
                "",



                url:

                data.url



            };


        }



    }

    catch(e){



        console.warn(

            "[IMD] API failed"

        );



    }





    return null;



}









// ==========================
// 备用音乐
// ==========================


function playBackupMusic(){



    const urls =

    imdSettings.backupMusic

    .filter(

        item=>item

    );






    if(
        urls.length===0
    ){



        $("#imd-title")

        .text(

            "No Music"

        );



        $("#imd-artist")

        .text(

            ""

        );



        return;


    }







    musicQueue =

    urls.map(

        url=>(

            {


                title:

                "Custom Music",



                artist:

                "Backup Source",



                url:url


            }

        )

    );






    musicIndex=0;



    playSong(

        musicQueue[0]

    );



}
// ==========================
// 美化绑定系统
// ==========================


function applyThemeBinding(){


    if(!imdSettings.enabled){


        disableDock();


        return;


    }




    // 没有绑定任何美化

    // 默认开启


    if(
        !imdSettings.bindThemes.length
    ){


        enableDock();


        return;


    }





    const themeText =
    getThemeInformation();




    const matched =

    imdSettings.bindThemes.some(

        item=>

        themeText.includes(item)

    );






    if(matched){


        enableDock();


    }

    else{


        disableDock();


    }



}







// ==========================
// 获取当前美化信息
// ==========================


function getThemeInformation(){



    let text="";



    // body class


    document.body.classList

    .forEach(

        item=>{


            text +=
            " "
            +
            item;


        }

    );





    // title_restorable


    text +=

    $("#title_restorable")
    .text()
    ||
    "";





    return text;



}







function enableDock(){



    $("#immersive-music-dock")

    .removeClass(

        "imd-hidden"

    );



}






function disableDock(){



    $("#immersive-music-dock")

    .addClass(

        "imd-hidden"

    );



    imdAudio.pause();



}









// ==========================
// 隐藏 s / t / #
// ==========================


function hideUnits(){



    $(".mes")

    .each(

        function(){



            const walker =

            document.createTreeWalker(

                this,

                NodeFilter.SHOW_TEXT

            );



            let nodes=[];




            while(
                walker.nextNode()
            ){


                nodes.push(

                    walker.currentNode

                );


            }





            nodes.forEach(

                node=>{


                    node.nodeValue =

                    node.nodeValue

                    // 楼层

                    .replace(

                        /#(\d+)/g,

                        "$1"

                    )


                    // token

                    .replace(

                        /(\d+)t\b/gi,

                        "$1"

                    )


                    // 秒

                    .replace(

                        /(\d+)s\b/gi,

                        "$1"

                    );



                }

            );



        }

    );



}








// ==========================
// 隐藏底栏文字
// 不影响按钮
// ==========================


function hideBottomText(){



    const dock =

    document.querySelector(

        "#immersive-music-dock"

    );



    const container =

    document.querySelector(

        "#nonQRFormItems"

    );



    if(
        !container
    )

    return;




    const walker =

    document.createTreeWalker(

        container,

        NodeFilter.SHOW_TEXT

    );




    const textNodes=[];



    while(
        walker.nextNode()
    ){



        if(
            walker.currentNode.parentElement
            &&
            !dock?.contains(
                walker.currentNode
            )
        ){


            textNodes.push(

                walker.currentNode

            );


        }


    }





    textNodes.forEach(

        node=>{


            node.parentElement.dataset.imdHiddenText=

            node.nodeValue;



            node.nodeValue="";



        }

    );



}









// ==========================
// 设置页面绑定
// ==========================


function bindSettings(){



    const context =
    getSTContext();



    const save =

    ()=>{


        context.saveSettingsDebounced();


    };






    $("#imd-enabled")

    .prop(

        "checked",

        imdSettings.enabled

    )

    .on(

        "change",

        function(){


            imdSettings.enabled =

            this.checked;



            save();



            applyThemeBinding();



        }

    );






    $("#imd-auto-music")

    .prop(

        "checked",

        imdSettings.autoMusic

    )

    .on(

        "change",

        function(){


            imdSettings.autoMusic=

            this.checked;


            save();


        }

    );






    $("#imd-auto-next")

    .prop(

        "checked",

        imdSettings.autoNext

    )

    .on(

        "change",

        function(){


            imdSettings.autoNext=

            this.checked;


            save();


        }

    );






    $("#imd-hide-units")

    .prop(

        "checked",

        imdSettings.hideUnits

    )

    .on(

        "change",

        function(){


            imdSettings.hideUnits=

            this.checked;


            save();


        }

    );






    $("#imd-volume")

    .val(

        imdSettings.volume

    )

    .on(

        "input",

        function(){


            imdSettings.volume=

            Number(
                this.value
            );



            imdAudio.volume=

            imdSettings.volume;



            save();


        }

    );






}









// ==========================
// 初始化监听补充
// ==========================


setTimeout(

()=>{


    bindSettings();



    applyThemeBinding();



    hideBottomText();



},

1500

);









// ==========================
// 全局调试
// ==========================


window.ImmersiveMusicDock={



    playSong,


    nextSong,


    previousSong,


    findMusic,


    updateAvatars,


    settings:imdSettings



};




console.log(

"[Immersive Music Dock] Loaded"

);
// ==========================
// 设置界面初始化
// ==========================


function loadSettingsPanel(){


    $("#imd-enabled")
    .prop(
        "checked",
        imdSettings.enabled
    );



    $("#imd-auto-music")
    .prop(
        "checked",
        imdSettings.autoMusic
    );



    $("#imd-auto-next")
    .prop(
        "checked",
        imdSettings.autoNext
    );



    $("#imd-hide-units")
    .prop(
        "checked",
        imdSettings.hideUnits
    );



    $("#imd-volume")
    .val(
        imdSettings.volume
    );





    for(
        let i=0;i<5;i++
    ){

        $("#imd-backup-"+(i+1))
        .val(

            imdSettings.backupMusic[i]

        );

    }



    $("#imd-music-api")
    .val(

        imdSettings.musicApi

    );


}






// 保存备用音乐


$("#imd-save-backup")
.on(
"click",
()=>{


    for(
        let i=0;i<5;i++
    ){


        imdSettings.backupMusic[i]=

        $("#imd-backup-"+(i+1))
        .val();


    }



    getSTContext()
    .saveSettingsDebounced();



}

);





// API


$("#imd-music-api")
.on(
"change",
function(){


    imdSettings.musicApi=

    this.value;


    getSTContext()
    .saveSettingsDebounced();


}

);






// 测试播放


$("#imd-test-music")
.on(
"click",
()=>{


    playBackupMusic();


}

);





setTimeout(

()=>{


loadSettingsPanel();


},

2000

);